import { chromium, Browser, Page } from 'playwright';

export interface Property {
  id: string;
  title: string;
  price: string;
  deposit?: string;
  monthlyRent?: string;
  size: string;
  floor: string;
  address: string;
  description: string;
  link: string;
  imageUrl?: string;
}

export interface SearchOptions {
  areas: string[];          // 지역명 (용산구, 마포구 등)
  minSize?: number;         // 최소 평수
  maxSize?: number;         // 최대 평수
  minFloor?: number;        // 최소 층수
  roomType?: string[];      // 원룸, 투룸, 오피스텔
  tradeType?: 'rent' | 'jeonse' | 'all';  // 월세, 전세
  limit?: number;           // 결과 개수
}

export class NaverRealEstateScraper {
  private browser: Browser | null = null;

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async search(options: SearchOptions): Promise<Property[]> {
    if (!this.browser) {
      await this.init();
    }

    const page = await this.browser!.newPage();
    const results: Property[] = [];

    try {
      // 각 지역별로 검색
      for (const area of options.areas) {
        const areaResults = await this.searchArea(page, area, options);
        results.push(...areaResults);
        
        if (options.limit && results.length >= options.limit) {
          break;
        }
      }
    } finally {
      await page.close();
    }

    // 층수 필터링 (2층 이상)
    const filtered = results.filter(p => {
      const floorMatch = p.floor.match(/(\d+)층/);
      if (floorMatch) {
        const floor = parseInt(floorMatch[1]);
        return floor >= (options.minFloor || 2);
      }
      // 반지하, 지하, 1층 제외
      if (p.floor.includes('지하') || p.floor.includes('반지') || p.floor === '1층') {
        return false;
      }
      return true;
    });

    return filtered.slice(0, options.limit || 20);
  }

  private async searchArea(page: Page, area: string, options: SearchOptions): Promise<Property[]> {
    const results: Property[] = [];
    
    // 네이버 부동산 검색 URL 구성
    const tradeParam = options.tradeType === 'rent' ? 'B2' : 
                       options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';
    
    // 지역 검색 페이지로 이동
    const searchUrl = `https://new.land.naver.com/rooms?ms=37.5,127,13&a=VL:OPST:OR&e=RETAIL&b=${tradeParam}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    
    // 검색창에 지역 입력
    await page.waitForSelector('input[placeholder*="검색"]', { timeout: 10000 });
    await page.fill('input[placeholder*="검색"]', area);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // 첫 번째 검색 결과 클릭
    const firstResult = await page.$('.search_list li:first-child');
    if (firstResult) {
      await firstResult.click();
      await page.waitForTimeout(3000);
    }

    // 매물 목록 스크롤하며 수집
    for (let i = 0; i < 3; i++) {
      const items = await page.$$('.item_list .item');
      
      for (const item of items) {
        try {
          const property = await this.parsePropertyItem(item, page);
          if (property && !results.find(r => r.id === property.id)) {
            // 면적 필터
            const sizeNum = parseFloat(property.size);
            if (options.minSize && sizeNum < options.minSize) continue;
            if (options.maxSize && sizeNum > options.maxSize) continue;
            
            results.push(property);
          }
        } catch (e) {
          // 파싱 실패 무시
        }
      }

      // 스크롤
      await page.evaluate(() => {
        const list = document.querySelector('.item_list');
        if (list) list.scrollTop += 500;
      });
      await page.waitForTimeout(1000);
    }

    return results;
  }

  private async parsePropertyItem(item: any, page: Page): Promise<Property | null> {
    try {
      const titleEl = await item.$('.item_title, .text_item');
      const priceEl = await item.$('.price_line, .item_price');
      const infoEl = await item.$('.info_area, .item_info');
      const linkEl = await item.$('a');

      const title = titleEl ? await titleEl.textContent() : '';
      const priceText = priceEl ? await priceEl.textContent() : '';
      const infoText = infoEl ? await infoEl.textContent() : '';
      const href = linkEl ? await linkEl.getAttribute('href') : '';

      // ID 추출
      const idMatch = href?.match(/(\d+)/);
      const id = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);

      // 가격 파싱
      let deposit = '';
      let monthlyRent = '';
      if (priceText?.includes('/')) {
        const parts = priceText.split('/');
        deposit = parts[0]?.trim() || '';
        monthlyRent = parts[1]?.trim() || '';
      }

      // 면적, 층수 파싱
      const sizeMatch = infoText?.match(/(\d+\.?\d*)㎡/) || infoText?.match(/(\d+\.?\d*)평/);
      const floorMatch = infoText?.match(/(\d+층|지하|반지하|옥탑)/);
      
      const size = sizeMatch ? sizeMatch[1] : '';
      const floor = floorMatch ? floorMatch[0] : '';

      return {
        id,
        title: title?.trim() || '',
        price: priceText?.trim() || '',
        deposit,
        monthlyRent,
        size,
        floor,
        address: '',
        description: infoText?.trim() || '',
        link: href ? `https://new.land.naver.com${href}` : ''
      };
    } catch {
      return null;
    }
  }
}
