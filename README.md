# TradingJournal — Google Sheets Web App

אפליקציית ווב קלה לניהול יומן עסקאות, רצה כ‑Google Apps Script Web App ונשענת על Google Sheets.

## מה כלול
- צד שרת (Apps Script): `Code.gs` — יצירת הגיליונות, REST-like endpoints, לוגיקת חישוב ועדכון יתרה.
- צד לקוח: `index.html`, `app.js`, `styles.css` — SPA RTL עם לוח מחוונים, יצירת עסקה, רשימת עסקאות והגדרות.

## יצירת הפרויקט ב‑Apps Script
1. פתחי את Google Drive, צרי Google Apps Script חדש (Empty project).
2. מחקי קבצים קיימים, והעתיקי את תוכן `Code.gs` לקובץ בשם `Code.gs`.
3. צרי קבצי HTML Template באותו פרויקט בשם `index`, `app`, `styles`, `partials` והדביקי את התוכן של `gas/index.html`, `gas/app.html`, `gas/styles.html`, `gas/partials.html` בהתאמה.
   - לחלופין, ניתן לפרוס מהקבצים כאן דרך `clasp` (מתקדם).
4. בתפריט Services ודאי שיש הרשאות ל‑Drive/Sheets במידת הצורך כאשר ירוץ לראשונה.

## Deploy כ‑Web App
1. בתפריט: Deploy → Manage deployments → New deployment.
2. Type: Web App.
3. Description: TradingJournal.
4. Execute as: Me.
5. Who has access: Anyone (או Anyone with link).
6. לחץ Deploy וקבלי את ה‑URL.

ביקורים ל‑URL בלי `path` יגישו את ה‑SPA. קריאות API דרך `?path=/api/...`.

## מבנה Sheets
האפליקציה תיצור מסמך בשם `TradingJournal` עם גיליונות:
- `Settings`: טבלת key/value (starting_balance, daily_target, daily_max_loss, tp_pct, sl_pct), ומתחת כותרת אינסטרומנטים: `symbol, tick_size, tick_value, contract_size`.
- `Trades`: כותרות בדיוק לפי הדרישה.
- `Balances`: כותרות: datetime, balance, change, reason.

## בדיקות/ולידציות
- צד שרת מוודא יצירת כותרות, בודק אי-שוויון Entry/Stop, ומחשב כמות לפי סיכון כספי וה‑tick settings.
- סימון TP/SL/BE/Partial מעדכן PnL, מזכה/מחייב עמלות, מעדכן balance_after ומוסיף רשומה ל‑Balances.
- צד לקוח מבצע ולידציות שדות בסיסיות ושומר טיוטה של טופס "עסקה חדשה" ב‑localStorage.

## טיפים
- ל‑MNQ הוסיפי שורה ב‑Settings תחת טבלת האינסטרומנטים (למשל: symbol=MNQ, tick_size=0.25, tick_value=0.5, contract_size=1).
- שינוי אחוזי TP/SL ויעדים דרך מסך "הגדרות" ייכתב חזרה ל‑Settings.
- ניתן לשנות את ברירת המחדל ל‑starting_balance ב‑Settings.

## קריאות API לדוגמה (באמצעות הדפדפן)
- GET הגדרות: `<WEB_APP_URL>/exec?path=/api/settings`
- יצירת עסקה: POST ל‑`<WEB_APP_URL>/exec?path=/api/trades` עם JSON
- סימון TP: POST ל‑`<WEB_APP_URL>/exec?path=/api/trades/1/mark` עם `{ "action": "TP" }`

