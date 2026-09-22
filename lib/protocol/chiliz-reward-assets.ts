export type ChilizRewardCategory = "Football" | "Motorsport" | "Combat" | "Esports" | "Rugby" | "Tennis";

export const CHILIZ_CHAIN = {
  id: 88_888,
  hexId: "0x15B38",
  name: "Chiliz Chain",
  nativeCurrency: { name: "Chiliz", symbol: "CHZ", decimals: 18 },
  rpcUrl: "https://rpc.chiliz.com",
  explorerUrl: "https://scan.chiliz.com",
} as const;

export const KAYEN = {
  source: "https://kayen-protocol.gitbook.io/documentation/contract/tokens-in-kayen",
  router: "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F",
  factory: "0xE2918AA38088878546c1A18F2F9b1BC83297fdD3",
  wrapperFactory: "0xAEdcF2bf41891777c5F638A098bbdE1eDBa7B264",
  wrappedChz: "0x677F7e16C7Dd57be1D4C8aD1244883214953DC47",
} as const;

export type ChilizRewardAsset = {
  symbol: string;
  name: string;
  category: ChilizRewardCategory;
  contract: `0x${string}`;
  wrappedContract: `0x${string}`;
  imagePath?: string;
};

export const CHILIZ_REWARD_ASSETS: ReadonlyArray<ChilizRewardAsset> = [
  { symbol: "ACM", name: "AC Milan", category: "Football", contract: "0xF9C0F80a6c67b1B39bdDF00ecD57f2533ef5b688", wrappedContract: "0x859DB9e2569bb87990482fC53E2F902E52585Ecb", imagePath: "/fan-tokens/ACM.png" },
  { symbol: "SAUBER", name: "Alfa Romeo Racing Orlen", category: "Motorsport", contract: "0xcf6D626203011e5554C82baBE17dd7CDC4Ee86BF", wrappedContract: "0x9632E5D03Bb7568b68096AbF34B1367B87295d82", imagePath: "/fan-tokens/SAUBER.png" },
  { symbol: "ALL", name: "Alliance", category: "Esports", contract: "0xc5C0d1E98D9b1398A37C82Ed81086674baEf2a72", wrappedContract: "0x1eb33b4243691f6FFbE0f77BBEa3be1C6b26E43E", imagePath: "/fan-tokens/ALL.png" },
  { symbol: "APL", name: "Apollon Limmasol", category: "Football", contract: "0xB407a167fE99eb97970e41b2608d0d9484C489C8", wrappedContract: "0xe265Db1EBEe1487Ea6EbA7ed9fdCECC8010c8e98", imagePath: "/fan-tokens/APL.png" },
  { symbol: "ARG", name: "Argentine Football Association", category: "Football", contract: "0xd34625c1c812439229EF53e06f22053249D011f5", wrappedContract: "0x7475777609CE0Bd8e06b471B95AC5330511e03aE", imagePath: "/fan-tokens/ARG.png" },
  { symbol: "AFC", name: "Arsenal FC", category: "Football", contract: "0x1d4343d35f0E0e14C14115876D01dEAa4792550b", wrappedContract: "0x109523174dD4431dFd2628eaF9435cFD14dC6c2f", imagePath: "/fan-tokens/AFC.png" },
  { symbol: "ASM", name: "AS Monaco", category: "Football", contract: "0x371863096CF5685cD37AE00C28DE10b6edBab3Fe", wrappedContract: "0x7Ad193240F89b2f60c087eb9aebcf64139Dd7b89", imagePath: "/fan-tokens/ASM.png" },
  { symbol: "ASR", name: "AS Roma", category: "Football", contract: "0xa6610b3361c4c0D206Aa3364cd985016c2d89386", wrappedContract: "0x36C8239aabd0C6F7856B20aD9DEEb5080adAf0fb", imagePath: "/fan-tokens/ASR.png" },
  { symbol: "AM", name: "Aston Martin Cognizant", category: "Motorsport", contract: "0x3757951792eDFC2CE196E4C06CFfD04027e87403", wrappedContract: "0xE51a3c216afB6e7c9BeBb4968CD4A8d1E0E99F77", imagePath: "/fan-tokens/AM.png" },
  { symbol: "AVL", name: "Aston Villa", category: "Football", contract: "0x095726841DC9Bf395114Ac83f8fd42B176cFAd10", wrappedContract: "0xC8f1C7267F7c362A178EB94Ac74877ea2F6c034c", imagePath: "/fan-tokens/AVL.png" },
  { symbol: "ATLAS", name: "Atlas FC", category: "Football", contract: "0x936AE5911F49634fD7f4F7385dB1613c5E350EdE", wrappedContract: "0x7B9d4199368CA5F567999Fc35Aa3F6f86b18D2F2", imagePath: "/fan-tokens/ATLAS.png" },
  { symbol: "ATM", name: "Atlético Madrid", category: "Football", contract: "0xe9506F70be469d2369803Ccf41823713BAFe8154", wrappedContract: "0x7Ac8cAa7c42e13d31247B1F370E2CF0c242957e8", imagePath: "/fan-tokens/ATM.png" },
  { symbol: "GALO", name: "Atlético Mineiro", category: "Football", contract: "0xe5274Eb169E0e3A60B9dC343F02BA940958e8683", wrappedContract: "0xb7ff11AA7612e8c04A276dFEa3ff95fFc9724EA1", imagePath: "/fan-tokens/GALO.png" },
  { symbol: "ALA", name: "Aytemiz Alanyaspor", category: "Football", contract: "0x863f7537B38130F01a42E9e9406573B1F1e309F7", wrappedContract: "0x685Ba5134F373785263DB5a5BC5CFF686264500b", imagePath: "/fan-tokens/ALA.png" },
  { symbol: "BUFC", name: "Bali United FC", category: "Football", contract: "0xe87Cb1546D50F523057d3F94B07381dCE3F85eF9", wrappedContract: "0x53DB5c49CE9d0AB222e3a7458af140B78f857c81", imagePath: "/fan-tokens/BUFC.png" },
  { symbol: "BFC", name: "Bologna FC", category: "Football", contract: "0x319067E6253FdbF183C27AbcAF31d45aD50E98fF", wrappedContract: "0x3Bce6c975Ed6Ed39aB80daC8774E5A6CE0E58515", imagePath: "/fan-tokens/BFC.png" },
  { symbol: "YBO", name: "BSC Young Boys", category: "Football", contract: "0x0Dc1776c56ffd3A046134Be6fDC23a3214359329", wrappedContract: "0xd14f7b7fD6D18A16c4f0c678E301a783D36a2BF0", imagePath: "/fan-tokens/YBO.png" },
  { symbol: "CAI", name: "Club Atlético Independiente", category: "Football", contract: "0x8A48AD8279318757ea7905b460816c4B92de447E", wrappedContract: "0xe6FfE9E1dE0E5bA375F10AeCA8E710225098D233", imagePath: "/fan-tokens/CAI.png" },
  { symbol: "CHVS", name: "Club Deportivo Guadalajara", category: "Football", contract: "0xF66288961A3495Ea9140fBD7c69E70a59Db08b16", wrappedContract: "0xB00d2468FB7471D080Ec301dcD1E12e334A1d9a3", imagePath: "/fan-tokens/CHVS.png" },
  { symbol: "SAN", name: "Club Santos Laguna", category: "Football", contract: "0x44941A2d2049BE0ACB00Baf0A5dEE8931c33712E", wrappedContract: "0x39C0E77Cb84a893166cC0E943b8e22b7F56Dc9f5", imagePath: "/fan-tokens/SAN.png" },
  { symbol: "TIGRES", name: "Club Tigres UANL", category: "Football", contract: "0xf17b1E028537ABa705433f7ceBdca881B5c5B79E", wrappedContract: "0x2EA082e1053f05EfFEB8E28c350fa0ff8fe78538", imagePath: "/fan-tokens/TIGRES.png" },
  { symbol: "SCCP", name: "Corinthians", category: "Football", contract: "0x20BFeab58f8bE903753d037Ba7e307fc77c97388", wrappedContract: "0x89c2b844Da2B9b12eE704E2b544cEC064a9243a2", imagePath: "/fan-tokens/SCCP.png" },
  { symbol: "CPFC", name: "Crystal Palace FC", category: "Football", contract: "0xA70bD29Bef2936765Fe33b0f4b0Cf8E947D75581", wrappedContract: "0x081232E5fee74ACa4C40bCe224C64e014A6AC245", imagePath: "/fan-tokens/CPFC.png" },
  { symbol: "DAVIS", name: "Davis Cup", category: "Tennis", contract: "0xF50b3db1d498b69b0dc8ccc0b03643009a6bDA78", wrappedContract: "0x82741b8B13e95eBA9b60dDb8b368F9b793E92f3a", imagePath: "/fan-tokens/DAVIS.png" },
  { symbol: "DZG", name: "Dinamo Zagreb", category: "Football", contract: "0x6412aFDFdF2a465B2E2464A5F9d1743a9CFfd6fF", wrappedContract: "0xD97215C8515688d1573B058b9D30bA04A6Af6aa2", imagePath: "/fan-tokens/DZG.png" },
  { symbol: "ENDCEX", name: "Endpoint", category: "Esports", contract: "0x3F521D391E2aD0093d3BFABB2516F1C57d73B4d1", wrappedContract: "0xAb445A85384287E5ea1265d3E393180d4b7aeA04", imagePath: "/fan-tokens/ENDCEX.png" },
  { symbol: "BAHIA", name: "Esporte Clube Bahia", category: "Football", contract: "0xE92e152fC0ff1368739670a5175175154Ceeef42", wrappedContract: "0x55BD5c6b24F3c445f7EA813Cc37eD16473057073", imagePath: "/fan-tokens/BAHIA.png" },
  { symbol: "EFC", name: "Everton", category: "Football", contract: "0xaBEE61f8fF0eADd8D4ee87092792aAF2D9B2CA8e", wrappedContract: "0xFC8799E0895b3B92936075F3B1A4D1bF5F183166", imagePath: "/fan-tokens/EFC.png" },
  { symbol: "BAR", name: "FC Barcelona", category: "Football", contract: "0xFD3C73b3B09D418841dd6Aff341b2d6e3abA433b", wrappedContract: "0xbaAAEF59F4A6C11cC87FF75EAa7a386e753b2666", imagePath: "/fan-tokens/BAR.png" },
  { symbol: "MENGO", name: "Flamengo", category: "Football", contract: "0xD1723Eb9e7C6eE7c7e2d421B2758dc0f2166eDDc", wrappedContract: "0xa8732Dbb1985a570a1d98F57001E3c837046F618", imagePath: "/fan-tokens/MENGO.png" },
  { symbol: "FLU", name: "Fluminense FC", category: "Football", contract: "0x86930777d43605C40bA786F7802778ff5413eFaB", wrappedContract: "0xD6E703752E5457825734f74eaF8813251A9970E4", imagePath: "/fan-tokens/FLU.png" },
  { symbol: "FOR", name: "Fortuna Sittard", category: "Football", contract: "0x4b56F121F769BBdeE3faBA6e8B9163E7cfFDd59a", wrappedContract: "0xf0f458B1E8Cd27d585De1baB5484B05C4d512a0E", imagePath: "/fan-tokens/FOR.png" },
  { symbol: "GAL", name: "Galatasaray S.K.", category: "Football", contract: "0x6DaB8Fe8e5d425F2Eb063aAe58540aA04e273E0d", wrappedContract: "0xCFc896fe8C791B6d1c085e69451E4B2f675a4927", imagePath: "/fan-tokens/GAL.png" },
  { symbol: "GFK", name: "Gaziantep F.K", category: "Football", contract: "0x2a5DbF10A9EB8d948AEF256FDE8e62F811624C4F", wrappedContract: "0x2bA57f4b99e9D2401381B2D2a1f60760CE3f1E82", imagePath: "/fan-tokens/GFK.png" },
  { symbol: "GOZ", name: "Goztepe", category: "Football", contract: "0x0E469D1C78421C7952E4D9626800DAd22F45361D", wrappedContract: "0x71103f7892c6c5BeCC135A22aFa9F021D905B750", imagePath: "/fan-tokens/GOZ.png" },
  { symbol: "QUINS", name: "Harlequins", category: "Rugby", contract: "0x539e00D2487a06F3F08CDAF7Bf7A8b4a32C3a14E", wrappedContract: "0x1f9002a9964894213507966c1F352Dcf1ACb1484", imagePath: "/fan-tokens/QUINS.png" },
  { symbol: "HASHTAG", name: "Hashtag United", category: "Esports", contract: "0x7Be4Aebc9900d2C1b628530ffc59416A98420B15", wrappedContract: "0xE8C45FBbFdC1bA65A05D9Eb9C0ffF71900492802", imagePath: "/fan-tokens/HASHTAG.png" },
  { symbol: "INTER", name: "Inter Milan", category: "Football", contract: "0xc727c9C0f2647CB90B0FCA64d8ddB14878716BeD", wrappedContract: "0xc587CF9ff27D7722ff4A3063abaFf81551803730", imagePath: "/fan-tokens/INTER.png" },
  { symbol: "IBFK", name: "İstanbul Başakşehir", category: "Football", contract: "0xd5FebD04baDd83e7ED56Ca093fD57655b737cd3e", wrappedContract: "0x3415C4bf4bDc284133831C2Ed414bC57Dbe5cFfc", imagePath: "/fan-tokens/IBFK.png" },
  { symbol: "ITA", name: "Italian National Football Team", category: "Football", contract: "0x7483263CA24BFcfF716a21F4a9bbF2610BDD9Ec9", wrappedContract: "0x9EccD05BBA630cba3E6E119f9243AA649F443b19", imagePath: "/fan-tokens/ITA.png" },
  { symbol: "JDT", name: "JOHOR Southern Tigers", category: "Football", contract: "0x12129aD866906Ab5aa456ae1ebAeA9e8A13E8197", wrappedContract: "0xdc9cAd4bceb669E823aEB30e80F2d124b0a58b6b", imagePath: "/fan-tokens/JDT.png" },
  { symbol: "JUV", name: "Juventus", category: "Football", contract: "0x454038003a93cf44766aF352F74bad6B745616D0", wrappedContract: "0xaCf221C4f6C713459981660e3146e64Cba54e0B1", imagePath: "/fan-tokens/JUV.png" },
  { symbol: "LUFC", name: "Leeds United", category: "Football", contract: "0xF67A8a4299f7EBF0c58DbFb38941D0867f300C30", wrappedContract: "0x2D271B3826090872a7A79DD69FFe660367f8579d", imagePath: "/fan-tokens/LUFC.png" },
  { symbol: "LEG", name: "Legia Warsaw", category: "Football", contract: "0x3Ce3946A68EB044C59AFe77dfdfdc71f19EB4328", wrappedContract: "0x58386A2d1c45D4c5349468892f5f73CA3E53EA22", imagePath: "/fan-tokens/LEG.png" },
  { symbol: "TIGERS", name: "Leicester Tigers", category: "Football", contract: "0x0b39ff3de07e8B6d2b97357d6F2A658ed7De52Cf", wrappedContract: "0x4b71E34bCb5feBa0dd51696863bcd792A84df196", imagePath: "/fan-tokens/TIGERS.png" },
  { symbol: "LEV", name: "Levante", category: "Football", contract: "0x69D65E72266b15C2b2ABcD69561399D9BD1843Ef", wrappedContract: "0xD37938861Bd995FdC016B6383ac7D78b345107BA", imagePath: "/fan-tokens/LEV.png" },
  { symbol: "MIBR", name: "Made In Brasil", category: "Esports", contract: "0xa8206Af1e6a0289156d45B9d60e5bbD5d1fCf68d", wrappedContract: "0x57488F1C881b2D5832D61781e741D09c5b3410Fb", imagePath: "/fan-tokens/MIBR.png" },
  { symbol: "CITY", name: "Manchester City", category: "Football", contract: "0x6401b29F40a02578Ae44241560625232A01B3F79", wrappedContract: "0x368F1EB2E4FA30C1C5957980C576Df6163575416", imagePath: "/fan-tokens/CITY.png" },
  { symbol: "MFC", name: "Millonarios FC", category: "Football", contract: "0xdEB5A271A67652A84dECb6278D70A6d6A18D7c3b", wrappedContract: "0xb1d0fADa44D28d31844241460d90C1775706126C", imagePath: "/fan-tokens/MFC.png" },
  { symbol: "NAP", name: "Napoli FC", category: "Football", contract: "0xbE7f1eBB1Fd6246844E093B04991ae0e66D12C77", wrappedContract: "0x9b24b3D55737BC28fdb21171ea5fD9eE50B136e6", imagePath: "/fan-tokens/NAP.png" },
  { symbol: "NOV", name: "Novara Calcio", category: "Football", contract: "0xE6BD000D6608E1E5d1476a96e7Cb63c335C595a9", wrappedContract: "0x5667DDD9764d1873D7a1bc15bc091a8B8a88EF1d" },
  { symbol: "OG", name: "OG", category: "Esports", contract: "0x19cA0F4aDb29e2130A56b9C9422150B5dc07f294", wrappedContract: "0x07Eb6147263F2Fedb00002bAdaFc79ea769240f2", imagePath: "/fan-tokens/OG.png" },
  { symbol: "VERDAO", name: "Palmeiras", category: "Football", contract: "0x971364Ec452958d4D65Ba8D508FAa226d7117279", wrappedContract: "0x6dB3ECA64DC5B789a70571BD81332864bA327A56", imagePath: "/fan-tokens/VERDAO.png" },
  { symbol: "PSG", name: "Paris Saint-Germain", category: "Football", contract: "0xc2661815C69c2B3924D3dd0c2C1358A1E38A3105", wrappedContract: "0x476eF844B3E8318b3bc887a7db07a1A0FEde5557", imagePath: "/fan-tokens/PSG.png" },
  { symbol: "PERSIB", name: "Persatuan Sepakbola Indonesia Bandung", category: "Football", contract: "0xC34BfBA5dB50152eF3312348A814D24F85748d64", wrappedContract: "0x22a82491C4bA35E6910213811ddE4F8702aE0709", imagePath: "/fan-tokens/PERSIB.png" },
  { symbol: "POR", name: "Portugal National Team", category: "Football", contract: "0xFFAD7930B474D45933C93b83A2802204b8787129", wrappedContract: "0x804C701c3d548d68773e4E06c76C03aFa0e32d42", imagePath: "/fan-tokens/POR.png" },
  { symbol: "PFL", name: "Professional Fighters League", category: "Combat", contract: "0xde05490B7AC4B86e54eFf43f4F809C3a7Bb16564", wrappedContract: "0x9b18841FE851f5B4b9400E67602eC2FE65aaaE0a", imagePath: "/fan-tokens/PFL.png" },
  { symbol: "RACING", name: "Racing Club", category: "Football", contract: "0x06Ed14A885D0710118fc20D51EfDC151a48005b3", wrappedContract: "0x7CB4FFbf64CD58fE6dC57ED8011b65b73691F0AD", imagePath: "/fan-tokens/RACING.png" },
  { symbol: "RSO", name: "Real Sociedad", category: "Football", contract: "0xdd03a533d6a309aFFF3053FE9Fc6C197324597bb", wrappedContract: "0xeF571542DcF394Da8B5190F75A20dacC07fAC741", imagePath: "/fan-tokens/RSO.png" },
  { symbol: "ROUSH", name: "Roush Fenway Keselowski", category: "Motorsport", contract: "0xBA20eF1670393150d1C1b135F45043740ec3a729", wrappedContract: "0x369C0bf5B24cfc088BD1E634ecDF95F786DBF5CB", imagePath: "/fan-tokens/ROUSH.png" },
  { symbol: "SAM", name: "Samsunspor", category: "Football", contract: "0xfC21C38f4802Ab29Aed8cc7367542A0955CfA9D7", wrappedContract: "0x72e24AaDEE54E65152C14246D2C62C1D42804764", imagePath: "/fan-tokens/SAM.png" },
  { symbol: "SPFC", name: "Sao Paulo FC", category: "Football", contract: "0x540165b9dFdDE31658F9BA0Ca5504EdA448BFfd0", wrappedContract: "0x60175b07658694FC1c16578376c439879C05d1Cb", imagePath: "/fan-tokens/SPFC.png" },
  { symbol: "SARRIES", name: "Saracens", category: "Rugby", contract: "0x753DDA10c7b3069f0C90837dC3755c7c40A81B8c", wrappedContract: "0xCcE302af2BBe84b5c44C3A460165816EE2fd7fF3", imagePath: "/fan-tokens/SARRIES.png" },
  { symbol: "SEVILLA", name: "Sevilla FC", category: "Football", contract: "0x60a5E1f5f0071C5d870bB0A80B411BDe908AD51e", wrappedContract: "0xb71597e18D9933b38a56817Ed74C64618232e325", imagePath: "/fan-tokens/SEVILLA.png" },
  { symbol: "STV", name: "Sint-Truidense Voetbalvereniging", category: "Football", contract: "0xe446d966Ba9a36E518cF450AbbD22f45688107Da", wrappedContract: "0x6d58211888D381D6Fd3D344A7a33789cE0628b01", imagePath: "/fan-tokens/STV.png" },
  { symbol: "BENFICA", name: "SL Benfica", category: "Football", contract: "0xad7c869F357B57BB03050183d1BA8eC465CD69Dc", wrappedContract: "0x8b11453f790726eC863422D47c2bDF6222dD0F2D", imagePath: "/fan-tokens/BENFICA.png" },
  { symbol: "SACI", name: "Sport Club Internacional", category: "Football", contract: "0x3175e779b42D35e2C9EeafadCf5B6E6ec6E4f910", wrappedContract: "0xE41a78C047E455C3f57F610091D0dE023A7b3D0B", imagePath: "/fan-tokens/SACI.png" },
  { symbol: "SFP", name: "Stade Francais Paris", category: "Rugby", contract: "0x2a89f8af25B01B837d67be3B1A162A663F77b26E", wrappedContract: "0x802B51D1Aa89C7222993463Ade8600cF08700DfF", imagePath: "/fan-tokens/SFP.png" },
  { symbol: "TH", name: "Team Heretics", category: "Esports", contract: "0x06B4213774DD069cF603ad11770B52F1E98160a7", wrappedContract: "0x6c5e381aF6E3B237F8471A7e1448A4CdF82d3447", imagePath: "/fan-tokens/TH.png" },
  { symbol: "SHARKS", name: "The Sharks", category: "Rugby", contract: "0x1f5Ed1182b673338ECff0eeaB13ed79cEaf775f5", wrappedContract: "0x8b8454ad0bc75C3C4bECb250b48D9a2072Fd55E3", imagePath: "/fan-tokens/SHARKS.png" },
  { symbol: "SPURS", name: "Tottenham Hotspur", category: "Football", contract: "0x93D84Ff2c5F5a5A3D7291B11aF97679E75eEAc92", wrappedContract: "0xf6Bebad8bE7bb9ce05b9A71b9ab62E2e7fA58e9f", imagePath: "/fan-tokens/SPURS.png" },
  { symbol: "TRA", name: "Trabzonspor", category: "Football", contract: "0x304193f18f3B34647ae1f549fc825A7e50267c51", wrappedContract: "0x80E5DCCABC8566d4b12812142A6609d6b9dd84CF", imagePath: "/fan-tokens/TRA.png" },
  { symbol: "UDI", name: "Udinese Calcio", category: "Football", contract: "0xd2571bb5E84F1a3ac643b6be1dD94fC9fb97041d", wrappedContract: "0xCE1E295c23D6c99909A414b0dDE447c15bB4Db7D" },
  { symbol: "UFC", name: "Ultimate Fighting Championship", category: "Combat", contract: "0x0ffa63502f957b66e61F87761cc240e51C74cee5", wrappedContract: "0xa698a6D7275A461D6F2D425E31dAB4a61a171AFd", imagePath: "/fan-tokens/UFC.png" },
  { symbol: "UCH", name: "Universidad de Chile", category: "Football", contract: "0xA082EC45aF038100D4989636A4A5E52fD7e5C636", wrappedContract: "0x1A21a5C735a48FdE12637D85501205A85FA9aB37", imagePath: "/fan-tokens/UCH.png" },
  { symbol: "VCF", name: "Valencia", category: "Football", contract: "0xba0c26485b1909f80476067272d74A99Cc0E1D57", wrappedContract: "0xf9ae77D7658ad1a1Ff49Ca4D082fEDb680A83373", imagePath: "/fan-tokens/VCF.png" },
  { symbol: "VASCO", name: "Vasco da Gama", category: "Football", contract: "0x6d72034D7508D16988bf84638D51592A8c02887b", wrappedContract: "0x2EAe5689908ac76996B70B48d5CE5d2f2fCC09e0", imagePath: "/fan-tokens/VASCO.png" },
  { symbol: "VIT", name: "Vitality", category: "Esports", contract: "0x1754bbc90F8C004EDBaCC59e41AA4be7a36B5D5b", wrappedContract: "0x82E159F2704A9d00f2079be89Dc1d6c499536957" },
];

export function getChilizRewardAsset(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  return CHILIZ_REWARD_ASSETS.find((asset) => asset.symbol === normalized) ?? null;
}
