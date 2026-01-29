import { chromium, Browser, BrowserContext } from 'playwright';

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
  minSize?: number;
  maxSize?: number;
  minFloor?: number;
  tradeType?: 'rent' | 'jeonse' | 'all';
  limit?: number;
}

// 한강 주변 좌표 (서울 중심)
const HANGANG_BOUNDS = {
  lat: 37.5326,
  lon: 126.9903,
  btm: 37.4850,
  lft: 126.9010,
  top: 37.5803,
  rgt: 127.0797
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

    const context = await this.browser!.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    });

    const results: Property[] = [];

    try {
      // Step 1: 클러스터 목록 가져오기
      const clusters = await this.fetchClusters(context, options);
      console.log(`Found ${clusters.length} clusters`);

      // Step 2: 각 클러스터에서 매물 가져오기
      for (const cluster of clusters.slice(0, 5)) { // 상위 5개 클러스터만
        try {
          const articles = await this.fetchArticlesFromCluster(context, cluster.lgeo, options);
          console.log(`Cluster ${cluster.lgeo}: ${articles.length} articles`);
          results.push(...articles);

          if (options.limit && results.length >= options.limit) {
            break;
          }

          // Rate limit 방지
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`Error fetching cluster ${cluster.lgeo}:`, e);
        }
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      await context.close();
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

  private async fetchClusters(context: BrowserContext, options: SearchOptions): Promise<any[]> {
    const page = await context.newPage();
    
    try {
      const tradeType = options.tradeType === 'rent' ? 'B2' : 
                        options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';

      const url = `https://m.land.naver.com/cluster/clusterList?view=atcl&rletTpCd=VL:OPST&tradTpCd=${tradeType}&z=13&lat=${HANGANG_BOUNDS.lat}&lon=${HANGANG_BOUNDS.lon}&btm=${HANGANG_BOUNDS.btm}&lft=${HANGANG_BOUNDS.lft}&top=${HANGANG_BOUNDS.top}&rgt=${HANGANG_BOUNDS.rgt}`;

      console.log(`Fetching clusters: ${url}`);
      
      const response = await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
      
      if (response) {
        const text = await response.text();
        const data = JSON.parse(text);
        
        if (data.code === 'success' && data.data?.ARTICLE) {
          // count가 많은 순으로 정렬
          return data.data.ARTICLE.sort((a: any, b: any) => b.count - a.count);
        }
      }
    } catch (e) {
      console.error('Failed to fetch clusters:', e);
    } finally {
      await page.close();
    }

    return [];
  }

  private async fetchArticlesFromCluster(context: BrowserContext, lgeo: string, options: SearchOptions): Promise<Property[]> {
    const page = await context.newPage();
    const results: Property[] = [];

    try {
      const tradeType = options.tradeType === 'rent' ? 'B2' : 
                        options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';

      const url = `https://m.land.naver.com/cluster/ajax/articleList?rletTpCd=VL:OPST&tradTpCd=${tradeType}&z=13&lgeo=${lgeo}&page=1`;

      console.log(`Fetching articles from lgeo ${lgeo}`);
      
      const response = await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
      
      if (response) {
        const text = await response.text();
        console.log(`Response for lgeo ${lgeo}: ${text.length} bytes`);
        
        const data = JSON.parse(text);
        
        if (data.code === 'success' && data.body && Array.isArray(data.body)) {
          for (const item of data.body) {
            // 면적 필터
            const size = parseFloat(item.spc2 || '0');
            if (options.minSize && size < options.minSize) continue;
            if (options.maxSize && size > options.maxSize) continue;

            const property: Property = {
              id: item.atclNo || String(Math.random()),
              title: item.atclNm || '매물',
              price: this.formatPrice(item),
              size: item.spc2 ? `${item.spc2}㎡` : '',
              floor: item.flrInfo || '',
              address: item.atclFetrDesc || item.sameAddrCnt ? `동일주소 ${item.sameAddrCnt}개` : '',
              description: [item.rletTpNm, item.tradTpNm, item.direction].filter(Boolean).join(' · '),
              link: `https://m.land.naver.com/article/info/${item.atclNo}`
            };
            results.push(property);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to fetch articles for lgeo ${lgeo}:`, e);
    } finally {
      await page.close();
    }

    return results;
  }

  private formatPrice(item: any): string {
    const parts: string[] = [];
    
    if (item.hanPrc) {
      parts.push(item.hanPrc);
    }
    
    if (item.rentPrc && item.rentPrc !== '0') {
      if (parts.length > 0) {
        return `${parts[0]}/${item.rentPrc}`;
      }
      parts.push(item.rentPrc);
    }
    
    return parts.join(' ') || item.prcInfo || '';
  }
}
