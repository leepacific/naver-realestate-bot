import { chromium, Browser, Page } from 'playwright';

export interface Property {
  id: string;
  title: string;
  price: string;
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

const AREA_CODES: Record<string, string> = {
  '용산구': '1117000000',
  '마포구': '1144000000', 
  '성동구': '1120000000',
  '광진구': '1121500000',
  '영등포구': '1156000000',
  '강남구': '1168000000',
  '서초구': '1165000000',
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
        console.log(`Searching ${area}...`);
        const areaResults = await this.searchAreaMobile(area, options);
        console.log(`Found ${areaResults.length} results in ${area}`);
        results.push(...areaResults);
        
        if (options.limit && results.length >= options.limit) {
          break;
        }
      } catch (error) {
        console.error(`Error searching ${area}:`, error);
      }
    }

    // 층수 필터링
    const filtered = results.filter(p => {
      if (!p.floor) return true;
      const floorMatch = p.floor.match(/(\d+)/);
      if (floorMatch) {
        const floor = parseInt(floorMatch[1]);
        return floor >= (options.minFloor || 2);
      }
      if (p.floor.includes('지하') || p.floor.includes('반지') || p.floor === '1층') {
        return false;
      }
      return true;
    });

    return filtered.slice(0, options.limit || 20);
  }

  private async searchAreaMobile(area: string, options: SearchOptions): Promise<Property[]> {
    const results: Property[] = [];
    const context = await this.browser!.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
    });
    
    const page = await context.newPage();
    
    try {
      const cortarNo = AREA_CODES[area];
      if (!cortarNo) {
        console.log(`Unknown area code for: ${area}`);
        return [];
      }

      // 모바일 버전 URL
      const tradeType = options.tradeType === 'rent' ? 'B2' : 
                        options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';
      
      const url = `https://m.land.naver.com/cluster/ajax/articleList?rletTpCd=OR:VL:OPST&tradTpCd=${tradeType}&z=13&cortarNo=${cortarNo}&page=1`;
      
      console.log(`Fetching: ${url}`);
      
      // API 직접 호출
      const response = await page.goto(url, { 
        waitUntil: 'commit',
        timeout: 15000 
      });
      
      if (response) {
        const text = await response.text();
        console.log(`Response length: ${text.length}`);
        
        try {
          const data = JSON.parse(text);
          
          if (data.body && Array.isArray(data.body)) {
            console.log(`Found ${data.body.length} items in API response`);
            
            for (const item of data.body) {
              const property: Property = {
                id: item.atclNo || String(Math.random()),
                title: item.atclNm || '매물',
                price: this.formatPrice(item.prcInfo || item.hanPrc || ''),
                size: item.spc2 ? `${item.spc2}㎡` : '',
                floor: item.flrInfo || '',
                address: item.atclFetrDesc || '',
                description: [item.rletTpNm, item.tradTpNm].filter(Boolean).join(' / '),
                link: `https://m.land.naver.com/article/info/${item.atclNo}`
              };
              results.push(property);
            }
          } else {
            console.log('No body in response:', JSON.stringify(data).slice(0, 200));
          }
        } catch (e) {
          console.error('Failed to parse response:', text.slice(0, 500));
        }
      }

      // API가 안되면 페이지 스크래핑 시도
      if (results.length === 0) {
        console.log('API failed, trying page scraping...');
        const pageUrl = `https://m.land.naver.com/cluster/clusterList?view=atcl&rletTpCd=OR:VL:OPST&tradTpCd=${tradeType}&z=13&cortarNo=${cortarNo}`;
        
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(2000);
        
        // 매물 리스트 찾기
        const items = await page.$$('.item_inner, .article_item, [class*="item"]');
        console.log(`Found ${items.length} DOM items`);
        
        for (const item of items.slice(0, 30)) {
          try {
            const title = await item.$eval('.item_title, .name, [class*="title"]', 
              el => el.textContent?.trim() || '').catch(() => '매물');
            const price = await item.$eval('.price, .item_price, [class*="price"]', 
              el => el.textContent?.trim() || '').catch(() => '');
            const info = await item.$eval('.info, .item_info, [class*="info"]', 
              el => el.textContent?.trim() || '').catch(() => '');
            
            if (title || price) {
              results.push({
                id: String(Math.random()),
                title,
                price,
                size: '',
                floor: '',
                address: '',
                description: info,
                link: ''
              });
            }
          } catch (e) {
            // ignore
          }
        }
      }

    } catch (error) {
      console.error(`Error in searchAreaMobile:`, error);
    } finally {
      await context.close();
    }

    return results;
  }

  private formatPrice(price: string): string {
    if (!price) return '';
    return price.replace(/\s+/g, ' ').trim();
  }
}
