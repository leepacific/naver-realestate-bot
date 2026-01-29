# Playwright 공식 이미지 사용 (Chromium 포함)
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 복사 및 빌드
COPY . .
RUN npm run build

# 환경변수
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
