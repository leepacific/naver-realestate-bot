import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import { NaverRealEstateScraper, SearchOptions, Property } from './scraper';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim());

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const scraper = new NaverRealEstateScraper();

// 사용자별 검색 조건 저장
const userFilters: Map<number, {
  tradeType: 'rent' | 'jeonse' | 'all';
  maxDeposit?: number;  // 만원 단위
  maxRent?: number;     // 만원 단위
}> = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(express.json());
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});

const isAllowed = (userId: number): boolean => {
  if (ALLOWED_USERS.length === 0 || ALLOWED_USERS[0] === '') return true;
  return ALLOWED_USERS.includes(userId.toString());
};

// /start
bot.command('start', (ctx) => {
  if (!isAllowed(ctx.from.id)) return;
  
  ctx.reply(`🏠 네이버 부동산 검색 봇

/hangang - 한강 주변 매물 검색 (조건 설정)
/search - 바로 검색 (기본 조건)

검색 조건:
• 원룸/투룸/오피스텔
• 8-13평, 2층 이상`);
});

// /hangang - 조건 설정 메뉴
bot.command('hangang', (ctx) => {
  if (!isAllowed(ctx.from.id)) return;
  
  // 기본 필터 초기화
  userFilters.set(ctx.from.id, { tradeType: 'all' });
  
  ctx.reply('🏠 거래 유형을 선택하세요:', 
    Markup.inlineKeyboard([
      [
        Markup.button.callback('전세', 'trade_jeonse'),
        Markup.button.callback('월세', 'trade_rent'),
        Markup.button.callback('전체', 'trade_all')
      ]
    ])
  );
});

// 거래 유형 선택
bot.action('trade_jeonse', (ctx) => {
  const filter = userFilters.get(ctx.from!.id) || { tradeType: 'all' };
  filter.tradeType = 'jeonse';
  userFilters.set(ctx.from!.id, filter);
  
  ctx.editMessageText('🏠 전세 보증금 조건:', 
    Markup.inlineKeyboard([
      [
        Markup.button.callback('1억 이하', 'dep_10000'),
        Markup.button.callback('2억 이하', 'dep_20000'),
        Markup.button.callback('3억 이하', 'dep_30000')
      ],
      [
        Markup.button.callback('5억 이하', 'dep_50000'),
        Markup.button.callback('제한 없음', 'dep_none')
      ]
    ])
  );
});

bot.action('trade_rent', (ctx) => {
  const filter = userFilters.get(ctx.from!.id) || { tradeType: 'all' };
  filter.tradeType = 'rent';
  userFilters.set(ctx.from!.id, filter);
  
  ctx.editMessageText('🏠 보증금 조건:', 
    Markup.inlineKeyboard([
      [
        Markup.button.callback('500만 이하', 'dep_500'),
        Markup.button.callback('1000만 이하', 'dep_1000'),
        Markup.button.callback('2000만 이하', 'dep_2000')
      ],
      [
        Markup.button.callback('3000만 이하', 'dep_3000'),
        Markup.button.callback('5000만 이하', 'dep_5000'),
        Markup.button.callback('제한 없음', 'dep_none')
      ]
    ])
  );
});

bot.action('trade_all', (ctx) => {
  const filter = userFilters.get(ctx.from!.id) || { tradeType: 'all' };
  filter.tradeType = 'all';
  userFilters.set(ctx.from!.id, filter);
  
  ctx.editMessageText('🏠 보증금 조건:', 
    Markup.inlineKeyboard([
      [
        Markup.button.callback('1000만 이하', 'dep_1000'),
        Markup.button.callback('3000만 이하', 'dep_3000'),
        Markup.button.callback('5000만 이하', 'dep_5000')
      ],
      [
        Markup.button.callback('1억 이하', 'dep_10000'),
        Markup.button.callback('제한 없음', 'dep_none')
      ]
    ])
  );
});

// 보증금 선택
bot.action(/^dep_(.+)$/, (ctx) => {
  const value = ctx.match[1];
  const filter = userFilters.get(ctx.from!.id) || { tradeType: 'all' };
  
  if (value !== 'none') {
    filter.maxDeposit = parseInt(value);
  }
  userFilters.set(ctx.from!.id, filter);
  
  // 월세인 경우에만 월세 조건 묻기
  if (filter.tradeType === 'rent' || filter.tradeType === 'all') {
    ctx.editMessageText('🏠 월세 조건:', 
      Markup.inlineKeyboard([
        [
          Markup.button.callback('30만 이하', 'rent_30'),
          Markup.button.callback('50만 이하', 'rent_50'),
          Markup.button.callback('80만 이하', 'rent_80')
        ],
        [
          Markup.button.callback('100만 이하', 'rent_100'),
          Markup.button.callback('150만 이하', 'rent_150'),
          Markup.button.callback('제한 없음', 'rent_none')
        ]
      ])
    );
  } else {
    // 전세는 바로 검색
    doSearch(ctx, filter);
  }
});

// 월세 선택 후 검색
bot.action(/^rent_(.+)$/, (ctx) => {
  const value = ctx.match[1];
  const filter = userFilters.get(ctx.from!.id) || { tradeType: 'all' };
  
  if (value !== 'none') {
    filter.maxRent = parseInt(value);
  }
  userFilters.set(ctx.from!.id, filter);
  
  doSearch(ctx, filter);
});

// /search - 바로 검색 (기본 조건)
bot.command('search', async (ctx) => {
  if (!isAllowed(ctx.from.id)) return;
  doSearch(ctx, { tradeType: 'all' });
});

// 검색 실행
async function doSearch(ctx: any, filter: any) {
  const conditionText = formatCondition(filter);
  
  await ctx.editMessageText(`🔍 검색 중... ${conditionText}\n(30초-1분 소요)`);
  
  try {
    await scraper.init();
    
    const options: SearchOptions = {
      minSize: 26,
      maxSize: 43,
      minFloor: 2,
      tradeType: filter.tradeType,
      limit: 20,
      maxDeposit: filter.maxDeposit,
      maxRent: filter.maxRent
    };
    
    const results = await scraper.search(options);
    
    if (results.length === 0) {
      await ctx.editMessageText(`😅 조건에 맞는 매물이 없어요.\n${conditionText}`);
      return;
    }

    let response = `🏠 한강 주변 매물 ${results.length}건\n${conditionText}\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const p = results[i];
      response += `${i + 1}. ${p.title}\n`;
      response += `   💰 ${p.price}\n`;
      if (p.size) response += `   📐 ${p.size}`;
      if (p.floor) response += ` | ${p.floor}`;
      response += '\n';
      if (p.description) response += `   ${p.description}\n`;
      if (p.link) response += `   🔗 ${p.link}\n`;
      response += '\n';
    }

    if (response.length > 4000) {
      await ctx.editMessageText(response.slice(0, 4000) + '...');
      await ctx.reply(response.slice(4000, 8000));
    } else {
      await ctx.editMessageText(response);
    }
  } catch (error) {
    console.error('Search error:', error);
    await ctx.editMessageText(`❌ 검색 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  } finally {
    await scraper.close();
  }
}

function formatCondition(filter: any): string {
  const parts: string[] = [];
  
  if (filter.tradeType === 'jeonse') parts.push('전세');
  else if (filter.tradeType === 'rent') parts.push('월세');
  else parts.push('전체');
  
  if (filter.maxDeposit) {
    if (filter.maxDeposit >= 10000) {
      parts.push(`보증금 ${filter.maxDeposit / 10000}억 이하`);
    } else {
      parts.push(`보증금 ${filter.maxDeposit}만 이하`);
    }
  }
  
  if (filter.maxRent) {
    parts.push(`월세 ${filter.maxRent}만 이하`);
  }
  
  return parts.length > 0 ? `[${parts.join(' · ')}]` : '';
}

async function main() {
  console.log('🏠 Naver Real Estate Bot starting...');
  
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN required');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
  });

  if (process.env.WEBHOOK_URL) {
    const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`✅ Webhook: ${webhookUrl}`);
  } else {
    bot.launch();
    console.log('✅ Polling mode');
  }
}

main().catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
