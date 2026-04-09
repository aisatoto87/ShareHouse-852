# ShareHouse 852 MVP 產品需求文檔 (PRD) - 管家模式版

## 一、 專案概述
- 專案名稱：ShareHouse 852
- 核心定位：一站式合租管家服務。用戶挑選心儀單位，平台負責媒合室友、與業主交涉並處理租務。
- [cite_start]開發戰略：零基礎 MVP 模式。無後端、無會員系統，純前端靜態展示 + WhatsApp 導流 [cite 1, 2]。
- [cite_start]技術棧：Next.js + Tailwind CSS + shadcnui [cite 2]。

## 二、 頁面佈局與視覺風格 (方案 A：現代極簡)
1. 頂部導航列 (Navbar)：
   - 左側：Logo ShareHouse 852。
   - 右側：一個醒目的「免費媒合諮詢」標籤。
2. 管家服務橫幅 (Hero Banner)：
   - 位於 Navbar 下方。
   - 主標題：『你揀樓，我哋幫你配對室友』。
   - 副標題：『一站式合租管家服務，免卻與業主交涉煩惱，輕鬆入住理想空間。』
   - 包含三個功能標籤：專業室友配對、代為與業主交涉、全程跟進。
3. 三維篩選器 (Sticky FilterBar)：
   - [cite_start]固定在頂部。提供「地區」、「租金範圍」、「居住面積」三個下拉選單 [cite 28]。
4. 租盤展示大廳 (Listing Grid)：
   - 響應式網格設計，展示多張租盤卡片。

## 三、 核心業務邏輯 (關鍵變更)
1. 中心化聯絡機制：
   - 所有的租盤卡片「不再」直接聯絡業主。
   - 卡片右下角按鈕統一為：「申請合租媒合」 (顏色為深海軍藍)。
2. WhatsApp 預填訊息邏輯：
   - 點擊按鈕後，統一跳轉至平台官方 WhatsApp (號碼：85211112222)。
   - 自動帶入預填訊息：`你好！我在平台上看到【租盤標題】，我想委託你們幫我尋找合適的室友與處理租務！`
3. 資料來源：
   - [cite_start]全部租盤資訊儲存於本地 `data.json` [cite 2]。

## 四、 UI 組件拆解
- Navbar：品牌 Logo 展示。
- HeroSection：宣傳管家服務價值。
- FilterBar：處理篩選狀態管理。
- PropertyCard：顯示房屋照片、標籤（即走、免佣）、地區、面積、租金與申請按鈕。
- ListingGrid：負責根據篩選條件循環渲染卡片。

## 五、 資料結構範例 (data.json)
[
  {
    id room-001,
    title 旺角高層開揚單人房,
    district 九龍,
    sub_district 旺角,
    price 5500,
    size_sqft 120,
    imageUrl httpsplacehold.co600x400png,
    tags [免佣, 包水電網],
    contact_whatsapp 85211112222
  }
]