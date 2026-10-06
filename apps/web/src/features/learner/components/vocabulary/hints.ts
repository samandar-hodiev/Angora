"use client";

import { useStoredLocale, type Locale } from "@/features/marketing/i18n";

/**
 * What each control on the lexicon pages does, shown on hover (the title attribute) and read
 * by screen readers — in the language the learner chose for the site.
 */
const hints = {
  en: {
    search: "Search in English, Uzbek or Russian — press / to jump here",
    level: "Show only the words of one level",
    filters: "Narrow the list: formality, part of speech, your list, sort order",
    showMeanings: "Show the meaning in every language",
    hideMeanings: "Hide the translated meanings again, to test yourself",
    columns: "Change the table: which languages, and in what order",
    revealOne: "Show this meaning",
    hideOne: "Hide this meaning",
    pick: "Pick to compare — choose two or three",
    unpick: "Remove from the comparison",
    add: "Add to my list, to review and learn it",
    open: "Open the full page: meanings, usage, similar words",
    listen: "Listen",
    clearSearch: "Clear the search",
    removeFilter: "Turn this filter off",
    clearAll: "Turn every filter off",
    explore: "Browse every entry by level, topic and formality",
    ladder: "The word for one meaning at every level, explained in Uzbek",
    compare: "See how two or three entries differ and when to use each",
    myList: "The entries you are learning, and today's review",
  },
  uz: {
    search: "Inglizcha, o'zbekcha yoki ruscha qidiring — bu yerga o'tish uchun / ni bosing",
    level: "Faqat bitta darajadagi so'zlarni ko'rsatish",
    filters: "Ro'yxatni toraytirish: rasmiylik, so'z turkumi, mening ro'yxatim, tartib",
    showMeanings: "Barcha tillarda ma'nosini ko'rsatish",
    hideMeanings: "Tarjima qilingan ma'nolarni yana yashirish — o'zingizni sinang",
    columns: "Jadvalni o'zgartirish: qaysi tillar va qanday tartibda",
    revealOne: "Bu ma'noni ko'rsatish",
    hideOne: "Bu ma'noni yashirish",
    pick: "Solishtirish uchun tanlash — ikki yoki uchtasini tanlang",
    unpick: "Solishtirishdan olib tashlash",
    add: "Takrorlab o'rganish uchun mening ro'yxatimga qo'shish",
    open: "To'liq sahifani ochish: ma'nolari, ishlatilishi, o'xshash so'zlar",
    listen: "Tinglash",
    clearSearch: "Qidiruvni tozalash",
    removeFilter: "Bu filtrni o'chirish",
    clearAll: "Barcha filtrlarni o'chirish",
    explore: "Barcha yozuvlarni daraja, mavzu va rasmiylik bo'yicha ko'rish",
    ladder: "Bitta ma'no uchun har darajadagi so'z, o'zbekcha izoh bilan",
    compare: "Ikki-uch yozuv qanday farq qilishi va qachon qaysi biri ishlatilishi",
    myList: "O'rganayotgan yozuvlaringiz va bugungi takrorlash",
  },
  ru: {
    search: "Ищите на английском, узбекском или русском — нажмите /, чтобы перейти сюда",
    level: "Показать слова только одного уровня",
    filters: "Сузить список: стиль, часть речи, мой список, порядок",
    showMeanings: "Показать значение на всех языках",
    hideMeanings: "Снова скрыть переводы значений — проверьте себя",
    columns: "Изменить таблицу: какие языки и в каком порядке",
    revealOne: "Показать это значение",
    hideOne: "Скрыть это значение",
    pick: "Выбрать для сравнения — два или три",
    unpick: "Убрать из сравнения",
    add: "Добавить в мой список, чтобы повторять и учить",
    open: "Открыть полную страницу: значения, употребление, похожие слова",
    listen: "Прослушать",
    clearSearch: "Очистить поиск",
    removeFilter: "Выключить этот фильтр",
    clearAll: "Выключить все фильтры",
    explore: "Все записи по уровню, теме и стилю",
    ladder: "Слово для одного значения на каждом уровне, с пояснением на узбекском",
    compare: "Чем отличаются две-три записи и когда что употреблять",
    myList: "Записи, которые вы учите, и сегодняшнее повторение",
  },
} satisfies Record<Locale, Record<string, string>>;

export type Hints = (typeof hints)["en"];

export function useHints(): Hints {
  return hints[useStoredLocale()];
}
