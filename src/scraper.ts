import https from 'https';
import http from 'http';

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
  maxDeposit?: number;  // 만원 단위
  maxRent?: number;     // 만원 단위
}

const HANGANG_BOUNDS = {
  lat: 37.5326,
  lon: 126.9903,
  btm: 37.4850,
  lft: 126.9010,
  top: 37.5803,
  rgt: 127.0797
};

export class NaverRealEstateScraper {
  async init() {
    // No browser to init
  }

  async close() {
    // No browser to close
  }

  async search(options: SearchOptions): Promise<Property[]> {
    const results: Property[] = [];

    try {
      // Step 1: 클러스터 목록 가져오기
      const clusters = await this.fetchClusters(options);
      console.log(`Found ${clusters.length} clusters`);

      // Step 2: 각 클러스터에서 매물 가져오기
      for (const cluster of clusters.slice(0, 5)) {
        try {
          const articles = await this.fetchArticlesFromCluster(cluster.lgeo, options);
          console.log(`Cluster ${cluster.lgeo}: ${articles.length} articles`);
          results.push(...articles);

          if (options.limit && results.length >= options.limit) {
            break;
          }

          // Rate limit 방지
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error(`Error fetching cluster ${cluster.lgeo}:`, e);
        }
      }
    } catch (error) {
      console.error('Search error:', error);
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

  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept': 'application/json',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Referer': 'https://m.land.naver.com/'
        }
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            console.error('JSON parse error:', data.slice(0, 200));
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  private async fetchClusters(options: SearchOptions): Promise<any[]> {
    const tradeType = options.tradeType === 'rent' ? 'B2' : 
                      options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';

    const url = `https://m.land.naver.com/cluster/clusterList?view=atcl&rletTpCd=VL:OPST&tradTpCd=${tradeType}&z=13&lat=${HANGANG_BOUNDS.lat}&lon=${HANGANG_BOUNDS.lon}&btm=${HANGANG_BOUNDS.btm}&lft=${HANGANG_BOUNDS.lft}&top=${HANGANG_BOUNDS.top}&rgt=${HANGANG_BOUNDS.rgt}`;

    console.log(`Fetching clusters...`);
    
    const data = await this.fetchJson(url);
    
    if (data.code === 'success' && data.data?.ARTICLE) {
      return data.data.ARTICLE.sort((a: any, b: any) => b.count - a.count);
    }

    console.log('Cluster response:', JSON.stringify(data).slice(0, 300));
    return [];
  }

  private async fetchArticlesFromCluster(lgeo: string, options: SearchOptions): Promise<Property[]> {
    const results: Property[] = [];
    const tradeType = options.tradeType === 'rent' ? 'B2' : 
                      options.tradeType === 'jeonse' ? 'B1' : 'B1:B2';

    const url = `https://m.land.naver.com/cluster/ajax/articleList?rletTpCd=VL:OPST&tradTpCd=${tradeType}&z=13&lgeo=${lgeo}&page=1`;

    console.log(`Fetching lgeo ${lgeo}...`);
    
    const data = await this.fetchJson(url);
    
    if (data.code === 'success' && data.body && Array.isArray(data.body)) {
      for (const item of data.body) {
        // 면적 필터
        const size = parseFloat(item.spc2 || '0');
        if (options.minSize && size < options.minSize) continue;
        if (options.maxSize && size > options.maxSize) continue;

        // 가격 필터 (prc는 만원 단위)
        const deposit = item.prc || 0;
        const rent = item.rentPrc || 0;
        
        if (options.maxDeposit && deposit > options.maxDeposit) continue;
        if (options.maxRent && rent > options.maxRent) continue;

        const property: Property = {
          id: item.atclNo || String(Math.random()),
          title: item.atclNm || '매물',
          price: this.formatPrice(item),
          size: item.spc2 ? `${item.spc2}㎡` : '',
          floor: item.flrInfo || '',
          address: item.atclFetrDesc || '',
          description: [item.rletTpNm, item.tradTpNm, item.direction].filter(Boolean).join(' · '),
          link: `https://m.land.naver.com/article/info/${item.atclNo}`
        };
        results.push(property);
      }
    } else {
      console.log(`lgeo ${lgeo} response:`, JSON.stringify(data).slice(0, 200));
    }

    return results;
  }

  private formatPrice(item: any): string {
    const parts: string[] = [];
    
    if (item.hanPrc) {
      parts.push(item.hanPrc);
    }
    
    if (item.rentPrc && item.rentPrc !== 0) {
      if (parts.length > 0) {
        return `${parts[0]}/${item.rentPrc}`;
      }
      parts.push(String(item.rentPrc));
    }
    
    return parts.join(' ') || item.prcInfo || '';
  }
}
