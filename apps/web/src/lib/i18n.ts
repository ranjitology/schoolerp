import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LOCALES = ['en', 'ne', 'ar'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: readonly string[] = ['ar'];

const en = {
  appName: 'SchoolERP',
  dashboard: 'Dashboard',
  students: 'Students',
  admissions: 'Admissions',
  attendance: 'Attendance',
  timetable: 'Timetable',
  questionBank: 'Question bank',
  homework: 'Homework',
  fees: 'Fees',
  hr: 'Human resources',
  payroll: 'Payroll',
  library: 'Library',
  transport: 'Transport',
  hostel: 'Hostel',
  inventory: 'Inventory',
  messages: 'Messages',
  reports: 'Reports',
  notices: 'Notices',
  settings: 'Settings',
  signIn: 'Sign in',
  signOut: 'Sign out',
  search: 'Search',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  create: 'Create',
  loading: 'Loading…',
  noResults: 'No results',
  language: 'Language',
} as const;

const ne = {
  appName: 'विद्यालय ERP',
  dashboard: 'ड्यासबोर्ड',
  students: 'विद्यार्थी',
  admissions: 'भर्ना',
  attendance: 'उपस्थिति',
  timetable: 'समयतालिका',
  questionBank: 'प्रश्न संग्रह',
  homework: 'गृहकार्य',
  fees: 'शुल्क',
  hr: 'मानव संसाधन',
  payroll: 'तलब',
  library: 'पुस्तकालय',
  transport: 'यातायात',
  hostel: 'छात्रावास',
  inventory: 'सामग्री',
  messages: 'सन्देश',
  reports: 'प्रतिवेदन',
  notices: 'सूचना',
  settings: 'सेटिङ',
  signIn: 'साइन इन',
  signOut: 'साइन आउट',
  search: 'खोज्नुहोस्',
  save: 'सुरक्षित गर्नुहोस्',
  cancel: 'रद्द गर्नुहोस्',
  delete: 'मेटाउनुहोस्',
  edit: 'सम्पादन',
  create: 'सिर्जना',
  loading: 'लोड हुँदैछ…',
  noResults: 'कुनै परिणाम फेला परेन',
  language: 'भाषा',
} as const;

const ar = {
  appName: 'نظام إدارة المدارس',
  dashboard: 'لوحة التحكم',
  students: 'الطلاب',
  admissions: 'التسجيل',
  attendance: 'الحضور',
  timetable: 'الجدول الدراسي',
  questionBank: 'بنك الأسئلة',
  homework: 'الواجبات',
  fees: 'الرسوم',
  hr: 'الموارد البشرية',
  payroll: 'الرواتب',
  library: 'المكتبة',
  transport: 'النقل',
  hostel: 'السكن',
  inventory: 'المخزون',
  messages: 'الرسائل',
  reports: 'التقارير',
  notices: 'الإعلانات',
  settings: 'الإعدادات',
  signIn: 'تسجيل الدخول',
  signOut: 'تسجيل الخروج',
  search: 'بحث',
  save: 'حفظ',
  cancel: 'إلغاء',
  delete: 'حذف',
  edit: 'تعديل',
  create: 'إنشاء',
  loading: 'جارٍ التحميل…',
  noResults: 'لا توجد نتائج',
  language: 'اللغة',
} as const;

function storedLocale(): SupportedLocale {
  const value = localStorage.getItem('erp.locale');
  return SUPPORTED_LOCALES.includes(value as SupportedLocale)
    ? (value as SupportedLocale)
    : 'en';
}

void i18n.use(initReactI18next).init({
  lng: storedLocale(),
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: en },
    ne: { translation: ne },
    ar: { translation: ar },
  },
});

/** Keeps `<html lang>` and `dir` in sync with the active locale. */
export function applyLocaleAttributes(locale: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

applyLocaleAttributes(i18n.language);
i18n.on('languageChanged', applyLocaleAttributes);

export default i18n;
