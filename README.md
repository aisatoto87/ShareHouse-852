# ShareHouse 852 — 快速啟動指南

## 1. 建立 Next.js 專案

```bash
npx create-next-app@latest sharehouse852 \
  --typescript --tailwind --eslint --app --src-dir=no \
  --import-alias="@/*"
cd sharehouse852
```

## 2. 安裝 shadcn/ui

```bash
npx shadcn@latest init
# 選擇: Default style → Zinc base color → CSS variables: yes
```

## 3. 安裝所需 UI 組件

```bash
npx shadcn@latest add card button select badge
```

## 4. 安裝字體與圖標（已內建於 next/font，無需額外安裝）
lucide-react 在建立專案時已自動包含於 shadcn 依賴中。

## 5. 複製專案檔案

將以下檔案複製到對應路徑：

```
data.json                          # 根目錄
.env.local                         # 根目錄
next.config.ts                     # 根目錄（替換原有）
types/property.ts                  # 新建
lib/filter.ts                      # 新建
app/layout.tsx                     # 替換原有
app/globals.css                    # 替換原有
app/page.tsx                       # 替換原有
components/Navbar.tsx              # 新建
components/HeroBanner.tsx          # 新建
components/FilterBar.tsx           # 新建
components/ListingShell.tsx        # 新建
components/ListingGrid.tsx         # 新建
components/PropertyCard.tsx        # 新建
```

## 6. 啟動開發伺服器

```bash
npm run dev
# 開啟 http://localhost:3000
```

## 7. 換成真實客服號碼

編輯 `.env.local`：
```
NEXT_PUBLIC_AGENT_WA=852YOUR_REAL_NUMBER
```

## 檔案結構總覽

```
sharehouse852/
├── data.json
├── .env.local
├── next.config.ts
├── types/
│   └── property.ts          # 共用 TypeScript 型別
├── lib/
│   └── filter.ts            # 篩選邏輯 + WhatsApp URL 生成
├── app/
│   ├── layout.tsx           # Root layout + 字體
│   ├── globals.css          # Tailwind + CSS tokens
│   └── page.tsx             # Server Component 入口
└── components/
    ├── Navbar.tsx            # 頂部固定導航列
    ├── HeroBanner.tsx        # 深色 Hero 橫幅
    ├── FilterBar.tsx         # 三欄篩選器（Client）
    ├── ListingShell.tsx      # 篩選狀態管理（Client）
    ├── ListingGrid.tsx       # 網格容器 + 空狀態
    └── PropertyCard.tsx      # 單一租盤卡片
```
