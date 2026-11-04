# OmniDown VN — Trình Tải Video Đa Mạng Xã Hội (`thichlendo.site`)

Ứng dụng web nhận diện tức thì 14+ mạng xã hội (TikTok, YouTube, Instagram, Facebook, X/Twitter, Douyin, Threads, Reddit, Vimeo, Bilibili, Pinterest, SoundCloud, Twitch, Dailymotion), hỗ trợ chọn chất lượng **4K → 360p** và tùy chọn **Có tiếng / Không tiếng (Muted) / Chỉ âm thanh MP3**.

## Hướng dẫn đồng bộ sang GitHub & Deploy GitHub Pages

> **Lưu ý quan trọng**: GitHub chặn các ứng dụng OAuth bên thứ ba (như nút đồng bộ GitHub của AI Studio) đẩy thư mục `.github/workflows/*.yml` lên kho lưu trữ (lỗi thiếu quyền `workflow` scope). Vì vậy, thư mục `.github/workflows` đã được gỡ khỏi cây thư mục tại đây để bạn có thể **Sao chép / Đồng bộ sang GitHub thành công ngay lập tức**.

Sau khi đẩy code sang GitHub thành công, nếu bạn muốn tự động build lên GitHub Pages (`thichlendo.site`), hãy vào kho lưu trữ trên trang web GitHub → bấm **Add file** → **Create new file** → đặt tên là `.github/workflows/static.yml` và dán nội dung sau:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build-and-deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm install --legacy-peer-deps

      - name: Build project
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```
