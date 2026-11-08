// Reference data for ShieldCast. Product facts come from November 2026 Indian pharmacy listings.
// Clinical rules follow the PRISM-ISF Delphi consensus (J Cosmet Dermatol, 2025) and WHO UV index guidance.

export const SKUS = {
  gold:    { id: "gold",    name: "Photostable Gold",    short: "Gold",    mrp: 1039, label: "SPF 55, PA+++",   texture: "Matte gel",  img: "assets/tube_gold.png",
             role: "Oily or combination skin, tanning and post-acne marks, long outdoor days." },
  acne:    { id: "acne",    name: "Photostable Acne",    short: "Acne",    mrp: 971,  label: "Gel for acne-prone skin", texture: "Light oil-free gel", img: "assets/tube_acne.png",
             role: "Acne-prone skin and patients on retinoids or isotretinoin." },
  emulgel: { id: "emulgel", name: "Photostable Emulgel", short: "Emulgel", mrp: 971,  label: "Emulgel",          texture: "Light emulgel", img: "assets/tube_emulgel.png",
             role: "Normal to dry skin and daily use on indoor or cool, dry days." },
  pro:     { id: "pro",     name: "Photostable Pro+",    short: "Pro+",    mrp: 974,  label: "SPF 80+, PA++++", texture: "Hydragel", img: "assets/tube_proplus.png",
             role: "Melasma and pigmentation made worse by visible light. It claims UV, visible light and infrared cover." },
};
export const SKU_ORDER = ["pro", "gold", "acne", "emulgel"];

// Each need sets the first-choice variant, the doctor's backup and the reapplication interval in hours.
export const NEEDS = {
  mel:  { id: "mel",  label: "Melasma",                     base: "pro",     backup: "gold",    reapplyH: 2, note: "The Delphi panel advises reapplying every 2 to 3 hours for melasma. Visible-light protection improved MASI scores by 15% more than UV-only sunscreen in a randomised trial." },
  acne: { id: "acne", label: "Acne or on retinoids",        base: "acne",    backup: "gold",    reapplyH: 3, note: "The Delphi panel advises gel or dry-touch textures for acne-prone skin." },
  pih:  { id: "pih",  label: "Tanning or post-acne marks",  base: "gold",    backup: "pro",     reapplyH: 3, note: "Broad-spectrum SPF 30 or more, reapplied when outdoors." },
  daily:{ id: "daily",label: "Daily protection, dry skin",  base: "emulgel", backup: "pro",     reapplyH: 3, note: "A comfortable texture is what keeps patients using sunscreen every day." },
  drug: { id: "drug", label: "Sun-sensitising medicine",    base: "emulgel", backup: "gold",    reapplyH: 2, note: "Patients on photosensitising drugs need strict reapplication outdoors." },
  proc: { id: "proc", label: "After a laser or peel",       base: null,      backup: null,      reapplyH: 2, note: "The Delphi panel advises a mineral sunscreen after procedures. Photostable has no mineral variant, so ShieldCast logs this as a portfolio gap." },
};

// The doctor may add a second tube with a weather rule. This is the clinical reason for writing two variants.
export const SWITCHES = {
  none:  { id: "none",  label: "No second tube" },
  humid: { id: "humid", label: "Humid days: switch to a matte gel", when: "Relative humidity at midday is 75% or more", sku: "gold" },
  dry:   { id: "dry",   label: "Dry or cool days: switch to Emulgel", when: "Relative humidity at midday is below 40%", sku: "emulgel" },
  peak:  { id: "peak",  label: "Very high UV days: switch to Pro+", when: "Peak UV index is 8 or more", sku: "pro" },
};

// Where the patient is outdoors. Hours are local decimal hours.
export const ROUTINES = {
  commute: { id: "commute", label: "Two-wheeler commute and lunch out", windows: [[8.5, 9.5], [13, 13.5], [18, 19]] },
  field:   { id: "field",   label: "Field work, mostly outdoors", windows: [[10, 17]] },
  office:  { id: "office",  label: "Office, near a window", windows: [[9, 9.5], [13, 13.5], [18, 18.5]] },
  home:    { id: "home",    label: "Mostly at home", windows: [[11, 11.5], [17, 17.5]] },
};

export const CITIES = {
  pune:      { id: "pune",      name: "Pune",      lat: 18.52, lon: 73.86 },
  mumbai:    { id: "mumbai",    name: "Mumbai",    lat: 19.08, lon: 72.88 },
  delhi:     { id: "delhi",     name: "Delhi",     lat: 28.61, lon: 77.21 },
  bengaluru: { id: "bengaluru", name: "Bengaluru", lat: 12.97, lon: 77.59 },
  chennai:   { id: "chennai",   name: "Chennai",   lat: 13.08, lon: 80.27 },
  hyderabad: { id: "hyderabad", name: "Hyderabad", lat: 17.39, lon: 78.49 },
  kolkata:   { id: "kolkata",   name: "Kolkata",   lat: 22.57, lon: 88.36 },
  ahmedabad: { id: "ahmedabad", name: "Ahmedabad", lat: 23.02, lon: 72.57 },
};

// Example partner pharmacies. In production these come from Sun's stockist feed.
export const STORES = {
  pune: [
    { id: "shree", name: "Shree Medicals", dist: "300 m from the clinic", stock: { pro: 2, gold: 6, acne: 2, emulgel: 3 } },
    { id: "wellness", name: "Wellness Pharmacy", dist: "650 m from the clinic", stock: { pro: 0, gold: 4, acne: 0, emulgel: 1 } },
  ],
};
export function storesFor(city) {
  return STORES[city] || [
    { id: "p1", name: "Partner pharmacy 1", dist: "near the clinic", stock: { pro: 3, gold: 5, acne: 2, emulgel: 2 } },
    { id: "p2", name: "Partner pharmacy 2", dist: "near the clinic", stock: { pro: 1, gold: 2, acne: 0, emulgel: 4 } },
  ];
}

export const TUBE_G = 50;      // grams in a tube
export const DOSE_G = 1.25;    // two finger-lengths for face and neck, about 1.25 g; a 50 g tube lasts 40 days once daily
export const DOSE_TEXT = "Two finger-lengths for face and neck, 15 minutes before you step out";

export const SITE_URL = "https://sabyapro123.github.io/photostable-shieldcast/";
