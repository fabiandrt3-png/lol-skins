const WIKI = "https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/";
const TENCENT_CHROMA = "https://game.gtimg.cn/images/lol/act/a20230715chromahub/skin/";

function slugify(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function wikiFile(champion, descriptor, suffix = "") {
  const prefix = String(champion).replaceAll(" ", "_");
  return `${WIKI}${encodeURIComponent(`${prefix}_${descriptor}Skin${suffix}.jpg`)}`;
}

function wikiSkin(champ, skin, releaseDate, descriptor) {
  const standard = wikiFile(champ, descriptor);
  const hd = wikiFile(champ, descriptor, "_HD");
  return {
    id: `${slugify(champ)}::${slugify(skin)}::pc`, champ, skin, type: "PC", releaseDate,
    image: standard,
    fallbacks: [hd],
    fullImage: hd,
    fullHdFallbacks: [standard],
  };
}

function wr(champ, skin, releaseDate, descriptor, extraFallbacks = []) {
  const standard = wikiFile(champ, descriptor, "_WR");
  const hd = wikiFile(champ, descriptor, "_WR_HD");
  const pcStandard = wikiFile(champ, descriptor, "");
  const pcHd = wikiFile(champ, descriptor, "_HD");
  return {
    id: `${slugify(champ)}::${slugify(skin)}::wild-rift`, champ, skin, type: "Wild Rift", releaseDate,
    image: standard,
    fallbacks: [...extraFallbacks, pcStandard, hd],
    fullImage: hd,
    fullHdFallbacks: [pcHd, standard, pcStandard, ...extraFallbacks],
  };
}

function pc(champ, skin, releaseDate, alias, number, descriptor) {
  const skinFolder = `skin${String(number).padStart(2, "0")}`;
  const root = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/${alias}/skins/${skinFolder}/images/${alias}_splash_`;
  const centered = `${root}centered_${number}.jpg`;
  const uncentered = `${root}uncentered_${number}.jpg`;
  return {
    id: `${slugify(champ)}::${slugify(skin)}::pc`, champ, skin, type: "PC", releaseDate,
    image: centered,
    fallbacks: [uncentered],
    fullImage: wikiFile(champ, descriptor, "_HD"),
    fullHdFallbacks: [uncentered, centered],
  };
}

function chinaChroma(champ, skin, releaseDate, assetId) {
  const image = `${TENCENT_CHROMA}site3-${assetId}.jpg`;
  return {
    id: `${slugify(champ)}::${slugify(skin)}::pc`, champ, skin, type: "PC", releaseDate,
    image,
    fallbacks: [],
    fullImage: image,
    fullHdFallbacks: [],
  };
}

export const postCutoffAdditions = [
  // Ahri historical backfill confirmed by the League Wiki HD skin category.
  // Prestige K/DA Ahri (2022) is intentionally not duplicated: its HD file redirects to the existing Prestige K/DA splash.
  wikiSkin("Ahri", "Arcana Ahri", "2022-04-14", "Arcana"),

  pc("Jayce", "Petals of Spring Jayce", "2026-02-19", "jayce", 38, "PetalsofSpring"),
  pc("Katarina", "Petals of Spring Katarina", "2026-02-19", "katarina", 70, "PetalsofSpring"),
  pc("Lillia", "Petals of Spring Lillia", "2026-02-19", "lillia", 46, "PetalsofSpring"),
  pc("Yasuo", "Petals of Spring Yasuo", "2026-02-19", "yasuo", 88, "PetalsofSpring"),

  wr("Vayne", "Dragonmancer Vayne", "2026-03-06", "Dragonmancer"),
  wr("Fiora", "Dragonmancer Fiora", "2026-03-06", "Dragonmancer"),
  wr("Nilah", "Dragonmancer Nilah", "2026-03-06", "Dragonmancer"),
  wr("Thresh", "Janitor Thresh", "2026-03-08", "Janitor"),
  wr("Mel", "Love Confession Mel", "2026-03-13", "LoveConfession"),
  wr("Jayce", "Love Confession Jayce", "2026-03-13", "LoveConfession"),

  wr("Master Yi", "PsyOps Master Yi (Special Edition)", "2026-04-09", "PsyOpsSpecialEdition"),
  wr("Viego", "Soul Fighter Viego", "2026-04-09", "SoulFighter"),
  wr("Senna", "Soul Fighter Senna", "2026-04-09", "SoulFighter"),
  wr("Ambessa", "Soul Fighter Ambessa", "2026-04-09", "SoulFighter"),
  wr("Viktor", "Soul Fighter Viktor", "2026-04-09", "SoulFighter"),
  wr("Varus", "Soul Fighter Varus", "2026-04-09", "SoulFighter"),
  wr("Varus", "Ascended Soul Fighter Varus", "2026-04-09", "AscendedSoulFighter"),
  wr("Jax", "Glorious Eminence Jax", "2026-04-10", "GloriousEminence"),

  wr("Kai'Sa", "Neon Daredevil Kai'Sa", "2026-04-30", "NeonDaredevil"),
  wr("Hecarim", "Neon Daredevil Hecarim", "2026-04-30", "NeonDaredevil"),
  wr("Irelia", "Neon Daredevil Irelia", "2026-04-30", "NeonDaredevil"),
  wr("Aurora", "Neon Daredevil Aurora", "2026-04-30", "NeonDaredevil"),
  wr("Zed", "Neon Daredevil Zed", "2026-04-30", "NeonDaredevil"),
  wr("Gragas", "Neon Daredevil Gragas", "2026-04-30", "NeonDaredevil"),
  wr("Kai'Sa", "Prestige Select Neon Daredevil Kai'Sa", "2026-04-30", "PrestigeSelectNeonDaredevil"),

  wr("Taliyah", "Pool Party Taliyah", "2026-05-15", "PoolParty"),
  wr("Norra", "Cafe Cuties Norra", "2026-05-20", "CafeCuties"),
  wr("Master Yi", "Neon Daredevil Master Yi: Origin", "2026-05-22", "NeonDaredevilOrigin"),
  wr("Master Yi", "Neon Daredevil Master Yi: Velocity", "2026-05-22", "NeonDaredevilVelocity"),
  wr("Master Yi", "Neon Daredevil Master Yi: Megacorps", "2026-05-22", "NeonDaredevilMegacorps"),
  wr("Master Yi", "Neon Daredevil Master Yi: Neon Speed", "2026-05-22", "NeonDaredevilNeonSpeed"),
  wr("Master Yi", "Neon Daredevil Master Yi: Swiftbladez", "2026-05-22", "NeonDaredevilSwiftbladez"),
  wr("Ornn", "Choo-Choo Ornn", "2026-06-06", "ChooChoo"),
  wr("Sion", "Plant Protector Sion", "2026-06-12", "PlantProtector"),
  wr("Samira", "Ashen Avenger Samira", "2026-06-12", "AshenAvenger"),

  wr("Yunara", "Weather Entity Yunara", "2026-07-09", "WeatherEntity"),
  wr("Poppy", "Weather Entity Poppy", "2026-07-09", "WeatherEntity"),
  wr("Nocturne", "Weather Entity Nocturne", "2026-07-09", "WeatherEntity"),
  wr("Ashe", "Weather Entity Ashe", "2026-07-09", "WeatherEntity"),
  wr("Vladimir", "Prestige Weather Entity Vladimir", "2026-07-09", "PrestigeWeatherEntity"),
  wr("Ryze", "Movie Director Ryze", "2026-07-09", "MovieDirector"),
  wr("Ryze", "Ascended Movie Director Ryze", "2026-07-09", "AscendedMovieDirector"),
  wr("Skarner", "Cosmic Sting Skarner", "2026-07-09", "CosmicSting"),
  wr("Renekton", "Glorious Eminence Renekton", "2026-07-10", "GloriousEminence"),
  wr("Lulu", "Purple Garlic Lulu", "2026-07-10", "PurpleGarlic"),
  wr("Galio", "Garden Party Galio", "2026-07-17", "GardenParty"),

  wr("Syndra", "Island Vacation Syndra", "2026-07-24", "IslandVacation"),
  wr("Gwen", "Island Vacation Gwen", "2026-07-24", "IslandVacation"),
  wr("Karma", "Island Vacation Karma", "2026-07-24", "IslandVacation"),
  wr("Morgana", "Island Vacation Morgana", "2026-07-24", "IslandVacation"),
  wr("Katarina", "Summer Party Katarina (Exquisite Edition)", "2026-07-24", "SummerPartyExquisiteEdition"),

  wr("Annie", "Annie-Versary", "2026-08-07", "Annie-Versary"),
  wr("Leona", "Crystal Rose Leona", "2026-08-14", "CrystalRose"),
  wr("Diana", "Crystal Rose Diana", "2026-08-14", "CrystalRose"),
  wr("Nami", "Crystal Rose Nami", "2026-08-14", "CrystalRose"),
  wr("Miss Fortune", "Crystal Rose Miss Fortune", "2026-08-14", "CrystalRose"),
  wr("Yasuo", "Crystal Rose Yasuo", "2026-08-14", "CrystalRose"),
  wr("Akali", "Prestige Crystal Rose Akali", "2026-08-14", "PrestigeCrystalRose"),
  wr("Sona", "Prestige Crystal Rose Sona", "2026-08-14", "PrestigeCrystalRose"),
  wr("Skarner", "Scorpio Deity Skarner", "2026-08-27", "ScorpioDeity"),
  wr("Skarner", "Scorpio Deity Ancient Wisdom Skarner", "2026-08-27", "ScorpioDeityAncientWisdom"),
  wr("Amumu", "Bookworm Amumu", "2026-08-28", "Bookworm"),
  wr("Nautilus", "Trash Diver Nautilus", "2026-08-28", "TrashDiver"),

  wr("Kayn", "Odyssey Kayn", "2026-09-04", "Odyssey"),
  wr("Lucian", "PROJECT: Lucian (Exquisite Edition)", "2026-09-04", "PROJECTExquisiteEdition"),
  wr("Pyke", "PROJECT: Pyke (Exquisite Edition)", "2026-09-04", "PROJECTExquisiteEdition"),
  wr("Varus", "Elf Forest Varus", "2026-09-10", "ElfForest"),

  // Patch 26.14: Tencent released two genuinely distinct Primordian Aatrox chroma splash arts.
  chinaChroma("Aatrox", "Primordian Aatrox (Ruby Chroma)", "2026-07-24", "04d46cbd-375b-406b-9038-c5c3455f2a9e"),
  chinaChroma("Aatrox", "Primordian Aatrox (Sapphire Chroma)", "2026-07-24", "0745a936-f477-408b-a743-870f9d6e96d8"),
];
