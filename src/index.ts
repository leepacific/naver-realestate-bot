import { Telegraf } from 'telegraf';
import express from 'express';
import { NaverRealEstateScraper, SearchOptions, Property } from './scraper';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim());

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const scraper = new NaverRealEstateScraper();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook endpoint for Telegram
app.use(express.json());
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});

// 권한 체크
const isAllowed = (userId: number): boolean => {
  if (ALLOWED_USERS.length === 0 || ALLOWED_USERS[0] === '') return true;
  return ALLOWED_USERS.includes(userId.toString());
};

// /start 명령어
bot.command('start', (ctx) => {
  if (!isAllowed(ctx.from.id)) return;
  
  ctx.reply(`🏠 네이버 부동산 검색 봇

사용법:
/search [지역] - 매물 검색
/hangang - 한강 주변 원룸/투룸 검색

예시:
/search 용산구 마포구
/hangang

옵션:
- 기본: 원룸/투룸/오피스텔, 8-12평, 2층 이상
- 월세/전세 모두 포함`);
});

// /hangang 명령어 - 한강 주변 검색
bot.command('hangang', async (ctx) => {
  if (!isAllowed(ctx.from.id)) return;
  
  const statusMsg = await ctx.reply('🔍 한강 주변 매물 검색 중... (1-2분 소요)');
  
  try {
    await scraper.init();
    
    const options: SearchOptions = {
      areas: ['용산구', '마포구', '성동구', '광진구', '영등포구'],
      minSize: 26,   // 약 8평
      maxSize: 43,   // 약 13평
      minFloor: 2,
      tradeType: 'all',
      limit: 20
    };
    
    const results = await scraper.search(options);
    
    if (results.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        '😅 조건에 맞는 매물을 찾지 못했어요.'
      );
      return;
    }

    // 결과 포맷팅
    let response = `🏠 한강 주변 매물 ${results.length}건\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const p = results[i];
      response += `${i + 1}. ${p.title || '매물'}\n`;
      response += `   💰 ${p.price}\n`;
      response += `   📐 ${p.size}㎡ | ${p.floor}\n`;
      if (p.link) response += `   🔗 ${p.link}\n`;
      response += '\n';
    }

    // 메시지가 너무 길면 분할
    if (response.length > 4000) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        response.slice(0, 4000) + '...'
      );
      await ctx.reply(response.slice(4000));
    } else {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        response
      );
    }
  } catch (error) {
    console.error('Search error:', error);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ 검색 중 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
    );
  } finally {
    await scraper.close();
  }
});

// /search 명령어 - 커스텀 지역 검색
bot.command('search', async (ctx) => {
  if (!isAllowed(ctx.from.id)) return;
  
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    ctx.reply('사용법: /search [지역1] [지역2] ...\n예시: /search 용산구 마포구');
    return;
  }

  const statusMsg = await ctx.reply(`🔍 ${args.join(', ')} 매물 검색 중... (1-2분 소요)`);
  
  try {
    await scraper.init();
    
    const options: SearchOptions = {
      areas: args,
      minSize: 26,
      maxSize: 43,
      minFloor: 2,
      tradeType: 'all',
      limit: 20
    };
    
    const results = await scraper.search(options);
    
    if (results.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        '😅 조건에 맞는 매물을 찾지 못했어요.'
      );
      return;
    }

    let response = `🏠 ${args.join(', ')} 매물 ${results.length}건\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const p = results[i];
      response += `${i + 1}. ${p.title || '매물'}\n`;
      response += `   💰 ${p.price}\n`;
      response += `   📐 ${p.size}㎡ | ${p.floor}\n`;
      if (p.link) response += `   🔗 ${p.link}\n`;
      response += '\n';
    }

    if (response.length > 4000) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        response.slice(0, 4000) + '...'
      );
      await ctx.reply(response.slice(4000));
    } else {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        response
      );
    }
  } catch (error) {
    console.error('Search error:', error);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ 검색 중 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
    );
  } finally {
    await scraper.close();
  }
});

// 시작
async function main() {
  console.log('🏠 Naver Real Estate Bot starting...');
  
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }

  // Express 서버 시작
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });

  // Webhook 또는 Polling 모드
  if (process.env.WEBHOOK_URL) {
    const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`✅ Webhook set to ${webhookUrl}`);
  } else {
    // Polling 모드 (개발용)
    bot.launch();
    console.log('✅ Bot started in polling mode');
  }
}

main().catch(console.error);

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
