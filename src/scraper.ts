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
}

export interface SearchOptions {
  areas: string[];
  minSize?: number;
  maxSize?: number;
  minFloor?: number;
  tradeType?: 'rent' | 'jeonse' | 'all';
  limit?: number;
}

// 지역 코드 매핑
const AREA_CODES: Record<string, string> = {
  '용산구': '1117000000',
  '마포구': '1144000000',
  '성동구': '1120000000',
  '광진구': '1121500000',
  '영등포구': '1156000000',
  '강남구': '1168000000',
  '서초구': '1165000000',
  '송파구': '1171000000',
};

export class NaverRealEstateScraper {
  private browser: Browser | null = null;

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async search(options: SearchOptions): Promise<Property[]> {
    if (!this.browser) {
      await this.init();
    }

    const results: Property[] = [];

    for (const area of options.areas) {
      try {
        const areaResults = await this.searchAreaDirect(area, options);
        results.push(...areaResults);
        
        if (options.limit && results.length >= options.limit) {
          break;
        }
      } catch (error) {
        console.error(`Error searching ${area}:`, error);
      }
    }

    // 층수 필터링 (2층 이상)
    const filtered = results.filter(p => {
      const floorMatch = p.floor.match(/(\d+)/);
      if (floorMatch) {
        const floor = parseInt(floorMatch[1]);
        return floor >= (options.minFloor || 2);
      }
      if (p.floor.includes('지하') || p.floor.includes('반지') || p.floor === '1층' || p.floor.includes('B')) {
        return false;
      }
      return true;
    });

    return filtered.slice(0, options.limit || 20);
  }

  private async searchAreaDirect(area: string, options: SearchOptions): Promise<Property[]> {
    const results: Property[] = [];
    const page = await this.browser!.newPage();
    
    try {
      // 지역 코드 가져오기
      const cortarNo = AREA_CODES[area];
      if (!cortarNo) {
        console.log(`Unknown area: ${area}`);
        return [];
      }

      // 거래 타입 설정
      const tradeType = options.tradeType === 'rent' ? 'B2' : 
                        options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';

      // 직접 매물 목록 페이지로 이동
      const url = `https://new.land.naver.com/rooms?ms=37.5,127,16&a=VL:OPST&e=RETAIL&b=${tradeType}&cc=${cortarNo}`;
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // 페이지 로딩 대기
      await page.waitForTimeout(3000);

      // 매물 리스트 추출 시도
      const items = await page.$$('article.item, div.item_inner, [class*="ItemCard"]');
      
      if (items.length === 0) {
        // 대안: 페이지 내용에서 JSON 데이터 추출
        const content = await page.content();
        const jsonMatch = content.match(/__NEXT_DATA__.*?({.*?})<\/script>/s);
        
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            // Next.js 데이터에서 매물 정보 추출
            const articles = data?.props?.pageProps?.articles || [];
            
            for (const article of articles.slice(0, 30)) {
              const property = this.parseArticle(article);
              if (property) {
                results.push(property);
              }
            }
          } catch (e) {
            console.error('Failed to parse JSON data:', e);
          }
        }
      } else {
        // DOM에서 직접 추출
        for (const item of items.slice(0, 30)) {
          try {
            const property = await this.parseItemElement(item);
            if (property) {
              results.push(property);
            }
          } catch (e) {
            // 파싱 실패 무시
          }
        }
      }

      // 결과가 없으면 스크린샷 저장 (디버깅용)
      if (results.length === 0) {
        console.log('No results found, page URL:', page.url());
      }

    } catch (error) {
      console.error(`Error in searchAreaDirect for ${area}:`, error);
    } finally {
      await page.close();
    }

    return results;
  }

  private parseArticle(article: any): Property | null {
    try {
      return {
        id: article.articleNo || article.atclNo || String(Math.random()),
        title: article.articleName || article.atclNm || '매물',
        price: article.dealOrWarrantPrc || article.prc || '',
        deposit: article.warrantPrc || '',
        monthlyRent: article.rentPrc || '',
        size: article.spc2 || article.excluUseAr || '',
        floor: article.flrInfo || article.floor || '',
        address: article.regionName || '',
        description: article.atclFetrDesc || article.tagList?.join(', ') || '',
        link: `https://new.land.naver.com/rooms?articleNo=${article.articleNo || article.atclNo}`
      };
    } catch {
      return null;
    }
  }

  private async parseItemElement(item: any): Promise<Property | null> {
    try {
      const getText = async (selector: string) => {
        const el = await item.$(selector);
        return el ? (await el.textContent())?.trim() || '' : '';
      };

      const getHref = async (selector: string) => {
        const el = await item.$(selector);
        return el ? await el.getAttribute('href') || '' : '';
      };

      const title = await getText('.item_title, .text_item, [class*="title"]');
      const price = await getText('.price_line, .item_price, [class*="price"]');
      const info = await getText('.info_area, .item_info, [class*="info"]');
      const href = await getHref('a');

      const sizeMatch = info.match(/(\d+\.?\d*)㎡/);
      const floorMatch = info.match(/(\d+층|지하|반지하|옥탑)/);

      const idMatch = href.match(/articleNo=(\d+)/) || href.match(/(\d+)/);

      return {
        id: idMatch ? idMatch[1] : String(Math.random()),
        title: title || '매물',
        price: price,
        size: sizeMatch ? sizeMatch[1] : '',
        floor: floorMatch ? floorMatch[0] : '',
        address: '',
        description: info,
        link: href.startsWith('http') ? href : `https://new.land.naver.com${href}`
      };
    } catch {
      return null;
    }
  }
}
