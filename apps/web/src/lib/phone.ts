/**
 * Phone numbers are stored in E.164 (+998901234567) with the ISO country the learner chose.
 * The list covers Engora's main markets plus common countries; it is presentation data only.
 */
export interface Country {
  code: string;
  name: string;
  dial: string;
}

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan", dial: "+93" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "AZ", name: "Azerbaijan", dial: "+994" },
  { code: "BD", name: "Bangladesh", dial: "+880" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "EG", name: "Egypt", dial: "+20" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "GE", name: "Georgia", dial: "+995" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "IR", name: "Iran", dial: "+98" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KZ", name: "Kazakhstan", dial: "+7" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "KG", name: "Kyrgyzstan", dial: "+996" },
  { code: "PK", name: "Pakistan", dial: "+92" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "RU", name: "Russia", dial: "+7" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "TJ", name: "Tajikistan", dial: "+992" },
  { code: "TR", name: "Türkiye", dial: "+90" },
  { code: "TM", name: "Turkmenistan", dial: "+993" },
  { code: "UA", name: "Ukraine", dial: "+380" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "UZ", name: "Uzbekistan", dial: "+998" },
  { code: "VN", name: "Vietnam", dial: "+84" },
];

export const DEFAULT_COUNTRY = "UZ";

export function findCountry(code: string | null | undefined): Country | undefined {
  return COUNTRIES.find((c) => c.code === code?.toUpperCase());
}

/** Picks a default country from the browser's locales (e.g. "uz-Latn-UZ" → UZ). */
export function detectCountry(locales: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages): string {
  for (const locale of locales) {
    try {
      const region = new Intl.Locale(locale).maximize().region;
      if (region && findCountry(region)) return region;
    } catch {
      // ignore malformed locales
    }
  }
  return DEFAULT_COUNTRY;
}

/** Builds an E.164 number from a country and what the learner typed; null when invalid. */
export function toE164(countryCode: string, input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  const number = trimmed.startsWith("+") ? `+${digits}` : `${findCountry(countryCode)?.dial ?? ""}${digits.replace(/^0+/, "")}`;
  return /^\+[1-9]\d{6,14}$/.test(number) ? number : null;
}

/** The part of an E.164 number after the country's dialling code, for editing. */
export function nationalPart(countryCode: string, e164: string | null | undefined): string {
  if (!e164) return "";
  const dial = findCountry(countryCode)?.dial;
  return dial && e164.startsWith(dial) ? e164.slice(dial.length) : e164;
}
