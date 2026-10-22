/**
 * Multilingual UI Localization Dictionary (Line 70)
 *
 * Implements:
 * 1. High-frequency retail UI terms translated across English, Hindi (हिन्दी), and Gujarati (ગુજરાતી).
 * 2. Instant client-side string resolver with language switcher hook.
 * 3. POS buttons, payment tender labels, cart summaries, and error notices.
 */

export type SupportedLanguage = "en" | "hi" | "gu";

export const UI_TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    "pos.title": "Point of Sale",
    "pos.scanOrSearch": "Scan Barcode or Search (F2)",
    "pos.cart": "Current Bill",
    "pos.holdBill": "Hold Bill (F6)",
    "pos.retrieveBill": "Recall Bill",
    "pos.clearCart": "Clear",
    "pos.total": "Total Amount",
    "pos.tax": "GST Included",
    "pos.discount": "Discount",
    "pos.checkout": "Complete Payment (F4)",
    "pos.cash": "Cash",
    "pos.upi": "UPI QR",
    "pos.card": "Card",
    "pos.khata": "Khata (Udhar)",
    "pos.thermalPrint": "Thermal Receipt",
    "pos.whatsapp": "Send WhatsApp",
    "nav.inventory": "Inventory",
    "nav.sales": "Sales",
    "nav.purchases": "Purchases",
    "nav.customers": "Customers",
    "nav.reports": "Reports",
    "nav.settings": "Settings",
  },
  hi: {
    "pos.title": "पॉइंट ऑफ़ सेल",
    "pos.scanOrSearch": "बारकोड स्कैन करें या खोजें (F2)",
    "pos.cart": "चालू बिल",
    "pos.holdBill": "बिल रोकें (F6)",
    "pos.retrieveBill": "रोका हुआ बिल लाएं",
    "pos.clearCart": "खाली करें",
    "pos.total": "कुल राशि",
    "pos.tax": "जीएसटी शामिल",
    "pos.discount": "छूट",
    "pos.checkout": "भुगतान पूरा करें (F4)",
    "pos.cash": "नकद",
    "pos.upi": "यूपीआई क्यूआर",
    "pos.card": "कार्ड",
    "pos.khata": "खाता (उधार)",
    "pos.thermalPrint": "थर्मल रसीद",
    "pos.whatsapp": "व्हाट्सएप भेजें",
    "nav.inventory": "इन्वेंट्री / स्टॉक",
    "nav.sales": "बिक्री",
    "nav.purchases": "खरीद",
    "nav.customers": "ग्राहक",
    "nav.reports": "रिपोर्ट्स",
    "nav.settings": "सेटिंग्स",
  },
  gu: {
    "pos.title": "પોઇન્ટ ઓફ સેલ",
    "pos.scanOrSearch": "બારકોડ સ્કેન કરો અથવા શોધો (F2)",
    "pos.cart": "ચાલુ બિલ",
    "pos.holdBill": "બિલ હોલ્ડ કરો (F6)",
    "pos.retrieveBill": "હોલ્ડ કરેલ બિલ લાવો",
    "pos.clearCart": "ખાલી કરો",
    "pos.total": "કુલ રકમ",
    "pos.tax": "જીએસટી સહિત",
    "pos.discount": "ડિસ્કાઉન્ટ",
    "pos.checkout": "ચુકવણી પૂર્ણ કરો (F4)",
    "pos.cash": "રોકડ",
    "pos.upi": "યુપીઆઈ ક્યૂઆર",
    "pos.card": "કાર્ડ",
    "pos.khata": "ખાતાવહી (ઉધાર)",
    "pos.thermalPrint": "થર્મલ રસીદ",
    "pos.whatsapp": "વોટ્સએપ મોકલો",
    "nav.inventory": "ઇન્વેન્ટરી / સ્ટોક",
    "nav.sales": "વેચાણ",
    "nav.purchases": "ખરીદી",
    "nav.customers": "ગ્રાહકો",
    "nav.reports": "રિપોર્ટ્સ",
    "nav.settings": "સેટિંગ્સ",
  },
};

export function translate(key: string, lang: SupportedLanguage = "en"): string {
  return UI_TRANSLATIONS[lang]?.[key] || UI_TRANSLATIONS.en[key] || key;
}
