/**
 * Hand-written facts about each model in the Carbon Garage.
 *
 * Only what is known about the car the model depicts: make, model, generation,
 * model year, category and body style. Published dimensions and specifications
 * appear only where the model's generation and variant are certain; a model
 * called "BMW M2 Coupe" with no generation gets no length, because the F87 and
 * G87 differ by 11 cm and guessing would scale it wrongly.
 *
 * `length` (mm) is what the viewer scales a model to. Without it the model's
 * own size is used when it is plausible, and a typical length for the body
 * style when it is not (see public/garage/src/cars/normalizer.js).
 *
 * Credits, licences and file sizes are not written here: they come from
 * src/data/vehicles/model-assets.json, which the fetch scripts maintain.
 */

const d = (length, width = null, height = null) => ({ length, width, height });
const s = (engine, powerHp = null) => ({ engine, powerHp });

export const GARAGE_VEHICLES = [
  // Sports and super cars
  { id: "porsche/911-gt3-rs", manufacturer: "Porsche", model: "911 GT3 RS", generation: "992", year: 2023, category: "Sports", bodyStyle: "Coupe", dimensions: d(4572, 1900, 1322), specifications: s("4.0 L flat-six", 518), featured: true },
  { id: "porsche/718-cayman", manufacturer: "Porsche", model: "718 Cayman GT4", generation: "982", year: 2020, category: "Sports", bodyStyle: "Coupe", dimensions: d(4456, 1801, 1269), specifications: s("4.0 L flat-six", 414), featured: true },
  { id: "chevrolet/corvette", manufacturer: "Chevrolet", model: "Corvette Stingray", generation: "C8", year: 2020, category: "Sports", bodyStyle: "Coupe", dimensions: d(4630, 1933, 1234), specifications: s("6.2 L V8", 490), featured: true },
  { id: "bmw/m4", manufacturer: "BMW", model: "M4", generation: "F82", year: 2015, category: "Sports", bodyStyle: "Coupe", dimensions: d(4671, 1870, 1383), specifications: s("3.0 L twin-turbo inline-six", 425), featured: true },
  { id: "bmw/m2", manufacturer: "BMW", model: "M2", generation: null, year: null, category: "Sports", bodyStyle: "Coupe", dimensions: null, specifications: null, featured: true },
  { id: "bmw/1m", manufacturer: "BMW", model: "1 Series M Coupé", generation: "E82", year: 2011, category: "Sports", bodyStyle: "Coupe", dimensions: d(4380, 1803, 1420), specifications: s("3.0 L twin-turbo inline-six", 335) },
  { id: "bmw/i8", manufacturer: "BMW", model: "i8", generation: "I12", year: 2015, category: "Sports", bodyStyle: "Coupe", dimensions: d(4689, 1942, 1291), specifications: s("1.5 L turbo three + electric", 357), featured: true },
  { id: "bmw/z3", manufacturer: "BMW", model: "Z3 Roadster", generation: "E36/7", year: 1999, category: "Sports", bodyStyle: "Roadster", dimensions: null, specifications: null },
  { id: "toyota/supra", manufacturer: "Toyota", model: "Supra", generation: null, year: null, category: "Sports", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "acura/nsx", manufacturer: "Acura", model: "NSX Roadster", generation: null, year: null, category: "Sports", bodyStyle: "Roadster", dimensions: null, specifications: null },
  { id: "alfa-romeo/4c", manufacturer: "Alfa Romeo", model: "4C", generation: "960", year: 2014, category: "Sports", bodyStyle: "Coupe", dimensions: d(3989, 1864, 1183), specifications: s("1.75 L turbo inline-four", 237) },
  { id: "audi/tt", manufacturer: "Audi", model: "TT", generation: "8N", year: 2001, category: "Sports", bodyStyle: "Coupe", dimensions: d(4041), specifications: null },
  { id: "audi/tt-rs", manufacturer: "Audi", model: "TT RS", generation: "8S", year: 2018, category: "Sports", bodyStyle: "Coupe", dimensions: null, specifications: s("2.5 L turbo inline-five", 394) },
  { id: "audi/rs-5", manufacturer: "Audi", model: "RS 5", generation: null, year: null, category: "Sports", bodyStyle: "Coupe", dimensions: null, specifications: null, featured: true },
  { id: "aston-martin/vantage", manufacturer: "Aston Martin", model: "V8 Vantage", generation: null, year: 2010, category: "Sports", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "lotus/elise", manufacturer: "Lotus", model: "Elise", generation: null, year: null, category: "Sports", bodyStyle: "Roadster", dimensions: null, specifications: null },
  { id: "lotus/evora", manufacturer: "Lotus", model: "Evora S", generation: null, year: 2011, category: "Sports", bodyStyle: "Coupe", dimensions: d(4342), specifications: s("3.5 L supercharged V6", 345) },
  { id: "dodge/viper", manufacturer: "Dodge", model: "Viper SRT-10", generation: "ZB II", year: 2010, category: "Sports", bodyStyle: "Coupe", dimensions: null, specifications: s("8.4 L V10", 600) },
  { id: "subaru/impreza", manufacturer: "Subaru", model: "Impreza WRX", generation: null, year: null, category: "Sports", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "mitsubishi/lancer-evolution", manufacturer: "Mitsubishi", model: "Lancer Evolution", generation: null, year: null, category: "Sports", bodyStyle: "Sedan", dimensions: null, specifications: null },

  { id: "mclaren/720s", manufacturer: "McLaren", model: "720S", generation: null, year: 2017, category: "Supercar", bodyStyle: "Coupe", dimensions: d(4543), specifications: s("4.0 L twin-turbo V8", 710), featured: true },
  { id: "mclaren/750s", manufacturer: "McLaren", model: "750S", generation: null, year: 2023, category: "Supercar", bodyStyle: "Coupe", dimensions: d(4569), specifications: s("4.0 L twin-turbo V8", 740), featured: true },
  { id: "mclaren/mp4-12c", manufacturer: "McLaren", model: "MP4-12C", generation: null, year: 2011, category: "Supercar", bodyStyle: "Coupe", dimensions: d(4509), specifications: s("3.8 L twin-turbo V8", 592) },
  { id: "lamborghini/murcielago", manufacturer: "Lamborghini", model: "Murciélago", generation: null, year: null, category: "Supercar", bodyStyle: "Coupe", dimensions: d(4580), specifications: null, featured: true },
  { id: "ford/gt", manufacturer: "Ford", model: "GT", generation: null, year: null, category: "Supercar", bodyStyle: "Coupe", dimensions: null, specifications: null, featured: true },

  { id: "mclaren/650s", manufacturer: "McLaren", model: "650S GT3", generation: null, year: null, category: "Race", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "audi/r8", manufacturer: "Audi", model: "R8 LMS", generation: null, year: 2016, category: "Race", bodyStyle: "Coupe", dimensions: null, specifications: null },

  // Grand tourers
  { id: "aston-martin/db11", manufacturer: "Aston Martin", model: "DB11 V12", generation: null, year: 2017, category: "GT", bodyStyle: "Coupe", dimensions: d(4739), specifications: s("5.2 L twin-turbo V12", 600), featured: true },
  { id: "aston-martin/dbs", manufacturer: "Aston Martin", model: "DBS", generation: null, year: null, category: "GT", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "bentley/continental", manufacturer: "Bentley", model: "Continental GT", generation: null, year: null, category: "GT", bodyStyle: "Coupe", dimensions: null, specifications: null, featured: true },
  { id: "bmw/m8", manufacturer: "BMW", model: "M8", generation: "F92", year: 2020, category: "GT", bodyStyle: "Coupe", dimensions: d(4867, 1907, 1362), specifications: null, featured: true },
  { id: "audi/e-tron-gt", manufacturer: "Audi", model: "e-tron GT", generation: null, year: 2021, category: "GT", bodyStyle: "Sedan", dimensions: d(4989, 1964, 1396), specifications: s("Dual electric motors"), featured: true },
  { id: "audi/rs-7", manufacturer: "Audi", model: "RS 7 Sportback", generation: null, year: null, category: "GT", bodyStyle: "Sedan", dimensions: null, specifications: null, featured: true },
  { id: "cadillac/elr", manufacturer: "Cadillac", model: "ELR", generation: null, year: 2014, category: "GT", bodyStyle: "Coupe", dimensions: null, specifications: null },

  // Muscle
  { id: "ford/mustang", manufacturer: "Ford", model: "Mustang Shelby GT500", generation: "S197", year: 2012, category: "Muscle", bodyStyle: "Coupe", dimensions: null, specifications: s("5.4 L supercharged V8", 550), featured: true },
  { id: "dodge/challenger", manufacturer: "Dodge", model: "Challenger SRT Demon", generation: "LC", year: 2018, category: "Muscle", bodyStyle: "Coupe", dimensions: null, specifications: s("6.2 L supercharged V8", 808), featured: true },
  { id: "chevrolet/camaro", manufacturer: "Chevrolet", model: "Camaro", generation: "5th gen", year: 2010, category: "Muscle", bodyStyle: "Coupe", dimensions: d(4836, 1918, 1376), specifications: null, featured: true },
  { id: "dodge/charger", manufacturer: "Dodge", model: "Charger", generation: "LD", year: 2011, category: "Muscle", bodyStyle: "Sedan", dimensions: null, specifications: null, featured: true },
  { id: "chevrolet/monte-carlo", manufacturer: "Chevrolet", model: "Monte Carlo SS", generation: null, year: null, category: "Muscle", bodyStyle: "Coupe", dimensions: null, specifications: null },

  // Sedans
  { id: "bmw/m5", manufacturer: "BMW", model: "M5", generation: "E60", year: 2009, category: "Sedan", bodyStyle: "Sedan", dimensions: d(4855, 1846, 1469), specifications: s("5.0 L V10", 500), featured: true },
  { id: "mercedes-benz/s-class", manufacturer: "Mercedes-Benz", model: "S-Class", generation: "W222", year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null, featured: true },
  { id: "audi/a7", manufacturer: "Audi", model: "A7 Sportback", generation: "C8", year: 2019, category: "Sedan", bodyStyle: "Sedan", dimensions: d(4969), specifications: null },
  { id: "audi/a3", manufacturer: "Audi", model: "A3 Sedan", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "bmw/320i", manufacturer: "BMW", model: "320i", generation: "E90", year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "bmw/alpina", manufacturer: "Alpina", model: "B10", generation: "E39", year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "cadillac/ct5", manufacturer: "Cadillac", model: "CT5", generation: null, year: 2020, category: "Sedan", bodyStyle: "Sedan", dimensions: d(4924), specifications: null },
  { id: "cadillac/ct6", manufacturer: "Cadillac", model: "CT6", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "cadillac/ats", manufacturer: "Cadillac", model: "ATS", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "cadillac/cts", manufacturer: "Cadillac", model: "CTS", generation: "1st gen", year: 2003, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "cadillac/dts", manufacturer: "Cadillac", model: "DTS", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "genesis/g70", manufacturer: "Genesis", model: "G70", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "buick/regal", manufacturer: "Buick", model: "Regal Sportback", generation: null, year: 2018, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "chrysler/300", manufacturer: "Chrysler", model: "300", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "chrysler/300c", manufacturer: "Chrysler", model: "300C", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "chevrolet/impala", manufacturer: "Chevrolet", model: "Impala", generation: null, year: 2009, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "chevrolet/cruze", manufacturer: "Chevrolet", model: "Cruze", generation: null, year: 2014, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "ford/crown-victoria", manufacturer: "Ford", model: "Crown Victoria", generation: null, year: null, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "ford/taurus", manufacturer: "Ford", model: "Taurus Police Interceptor", generation: null, year: 2012, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "honda/civic-si", manufacturer: "Honda", model: "Civic Si", generation: null, year: 2017, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },
  { id: "suzuki/esteem", manufacturer: "Suzuki", model: "Esteem", generation: null, year: 1998, category: "Sedan", bodyStyle: "Sedan", dimensions: null, specifications: null },

  // Hatchbacks and wagons
  { id: "honda/civic-type-r", manufacturer: "Honda", model: "Civic Type R", generation: null, year: null, category: "Hatchback", bodyStyle: "Hatchback", dimensions: null, specifications: null, featured: true },
  { id: "mini/cooper", manufacturer: "MINI", model: "Cooper S", generation: null, year: null, category: "Hatchback", bodyStyle: "Hatchback", dimensions: null, specifications: null },
  { id: "honda/fit", manufacturer: "Honda", model: "Fit", generation: null, year: null, category: "Hatchback", bodyStyle: "Hatchback", dimensions: null, specifications: null },
  { id: "dodge/caliber", manufacturer: "Dodge", model: "Caliber", generation: null, year: null, category: "Hatchback", bodyStyle: "Hatchback", dimensions: null, specifications: null },
  { id: "audi/rs-6-avant", manufacturer: "Audi", model: "RS 6 Avant", generation: null, year: null, category: "Wagon", bodyStyle: "Wagon", dimensions: null, specifications: null, featured: true },
  { id: "audi/rs-6", manufacturer: "Audi", model: "RS 6", generation: null, year: null, category: "Wagon", bodyStyle: "Wagon", dimensions: null, specifications: null },

  // SUVs
  { id: "bmw/x5", manufacturer: "BMW", model: "X5 M Competition", generation: "F95", year: 2020, category: "SUV", bodyStyle: "SUV", dimensions: d(4938), specifications: s("4.4 L twin-turbo V8", 617), featured: true },
  { id: "mercedes-benz/gle-class", manufacturer: "Mercedes-Benz", model: "GLE", generation: "W166", year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "audi/q7", manufacturer: "Audi", model: "Q7", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "cadillac/escalade", manufacturer: "Cadillac", model: "Escalade", generation: "5th gen", year: 2021, category: "SUV", bodyStyle: "SUV", dimensions: d(5382), specifications: null, featured: true },
  { id: "cadillac/escalade-esv", manufacturer: "Cadillac", model: "Escalade ESV", generation: null, year: 2007, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "cadillac/xt4", manufacturer: "Cadillac", model: "XT4", generation: null, year: 2019, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "ford/bronco", manufacturer: "Ford", model: "Bronco Wildtrak", generation: null, year: 2021, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null, featured: true },
  { id: "ford/expedition", manufacturer: "Ford", model: "Expedition", generation: null, year: 2020, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "ford/excursion", manufacturer: "Ford", model: "Excursion", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "ford/explorer", manufacturer: "Ford", model: "Explorer Police Interceptor", generation: null, year: 2014, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "ford/explorer-sport", manufacturer: "Ford", model: "Explorer Sport", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "ford/edge", manufacturer: "Ford", model: "Edge", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "ford/escape", manufacturer: "Ford", model: "Escape Hybrid", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "chevrolet/suburban", manufacturer: "Chevrolet", model: "Suburban", generation: null, year: 2015, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "chevrolet/tahoe", manufacturer: "Chevrolet", model: "Tahoe", generation: null, year: 2007, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "chevrolet/blazer", manufacturer: "Chevrolet", model: "Blazer", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "dodge/durango", manufacturer: "Dodge", model: "Durango", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "honda/cr-v", manufacturer: "Honda", model: "CR-V", generation: null, year: null, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "mitsubishi/outlander", manufacturer: "Mitsubishi", model: "Outlander", generation: null, year: 2016, category: "SUV", bodyStyle: "SUV", dimensions: null, specifications: null },
  { id: "chevrolet/orlando", manufacturer: "Chevrolet", model: "Orlando", generation: null, year: 2011, category: "SUV", bodyStyle: "MPV", dimensions: null, specifications: null },

  // Trucks and vans
  { id: "ford/f-150", manufacturer: "Ford", model: "F-150", generation: null, year: 2017, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null, featured: true },
  { id: "ford/f-250", manufacturer: "Ford", model: "F-250 Super Duty", generation: null, year: 2018, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "ford/f-350", manufacturer: "Ford", model: "F-350 Dually", generation: null, year: null, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "ford/f-450", manufacturer: "Ford", model: "F-450 Super Duty", generation: null, year: null, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "ford/ranger", manufacturer: "Ford", model: "Ranger", generation: null, year: 2002, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "ram/2500", manufacturer: "Ram", model: "2500", generation: null, year: 2020, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null, featured: true },
  { id: "chevrolet/silverado", manufacturer: "Chevrolet", model: "Silverado SS", generation: null, year: 2005, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "chevrolet/avalanche", manufacturer: "Chevrolet", model: "Avalanche Z71", generation: null, year: null, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "chevrolet/colorado", manufacturer: "Chevrolet", model: "Colorado", generation: null, year: 2010, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "gmc/sierra", manufacturer: "GMC", model: "Sierra", generation: null, year: 2005, category: "Truck", bodyStyle: "Pickup", dimensions: null, specifications: null },
  { id: "fiat/ducato", manufacturer: "Fiat", model: "Ducato", generation: null, year: 2014, category: "Truck", bodyStyle: "Van", dimensions: null, specifications: null },
  { id: "dodge/sprinter", manufacturer: "Dodge", model: "Sprinter", generation: null, year: null, category: "Truck", bodyStyle: "Van", dimensions: null, specifications: null },

  // Classics
  { id: "fiat/500", manufacturer: "Fiat", model: "500", generation: "Nuova 500", year: null, category: "Classic", bodyStyle: "Two-door", dimensions: d(2970), specifications: null, featured: true },
  { id: "ford/thunderbird", manufacturer: "Ford", model: "Thunderbird", generation: "4th gen", year: 1966, category: "Classic", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "cadillac/deville", manufacturer: "Cadillac", model: "Coupe DeVille", generation: null, year: null, category: "Classic", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "cadillac/eldorado", manufacturer: "Cadillac", model: "Eldorado", generation: null, year: null, category: "Classic", bodyStyle: "Coupe", dimensions: null, specifications: null },
  { id: "chevrolet/malibu", manufacturer: "Chevrolet", model: "Malibu", generation: null, year: 1982, category: "Classic", bodyStyle: "Sedan", dimensions: null, specifications: null },
];

/** Model entries that point at the same file as another entry and so are not listed twice. */
export const DUPLICATE_OF = { "audi/e-tron": "audi/e-tron-gt", "honda/civic": "honda/civic-si" };
