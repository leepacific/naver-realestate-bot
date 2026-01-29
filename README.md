# 네이버 부동산 검색 봇 🏠

Playwright + Telegram 기반 네이버 부동산 매물 검색 봇

## 기능

- `/hangang` - 한강 주변 (용산, 마포, 성동, 광진, 영등포) 원룸/투룸 검색
- `/search [지역]` - 특정 지역 매물 검색

## 검색 조건 (기본값)

- 면적: 8~13평 (26~43㎡)
- 층수: 2층 이상 (지하, 반지하, 1층 제외)
- 유형: 원룸, 투룸, 오피스텔
- 거래: 월세 + 전세

## Railway 배포

### 1. GitHub에 푸시

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/naver-realestate-bot.git
git push -u origin main
```

### 2. Railway 설정

1. [Railway](https://railway.app) 접속
2. New Project > Deploy from GitHub repo
3. 환경변수 설정:
   - `TELEGRAM_BOT_TOKEN`: BotFather에서 받은 토큰
   - `ALLOWED_USERS`: 허용할 Telegram user ID (쉼표 구분)
   - `WEBHOOK_URL`: Railway에서 제공하는 도메인 (예: https://xxx.up.railway.app)

### 3. 텔레그램 봇 생성

1. [@BotFather](https://t.me/BotFather) 에게 `/newbot` 전송
2. 봇 이름, username 설정
3. 받은 토큰을 Railway 환경변수에 설정

## 로컬 개발

```bash
npm install
npx playwright install chromium

# .env 파일 생성
echo "TELEGRAM_BOT_TOKEN=your_token_here" > .env

npm run dev
```

## 주의사항

- 네이버 부동산은 크롤링을 좋아하지 않음
- 과도한 요청 시 IP 차단 가능
- 개인 용도로만 사용 권장
