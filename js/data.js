/* ============================================================
 * 昆特牌数据 —— 巫师3 内置版（经典三排版）
 * 数据来源（2026-09 调研，双源交叉核对）：
 *   1) https://github.com/asundr/gwent-classic  (cards.js 引擎级数据)
 *   2) https://github.com/gwentcards/gwentcards.github.io (全收集清单, 张数/集合)
 *   3) https://www.gosunoob.com/witcher-3/witcher-3-gwent-cards-list/ (tiebreak)
 * 说明：仅基础游戏 4 阵营 + 中立 + 特殊牌；Skellige / 石之心 / 血与酒 卡不入牌池。
 * ============================================================ */
'use strict';

/* ---------------- 阵营 ---------------- */
const FACTIONS = {
  northern:  { zh: '北方领域', en: 'Northern Realms', emblem: '🦁', color1: '#2f5589', color2: '#101d33', tagline: '攻城器械与同袍' },
  nilfgaard: { zh: '尼弗迦德', en: 'Nilfgaard', emblem: '☀️', color1: '#3a3a2a', color2: '#14140c', tagline: '间谍与谋略' },
  scoiatael: { zh: '松鼠党', en: "Scoia'tael", emblem: '🍃', color1: '#2f5c37', color2: '#0f1f12', tagline: '敏捷与召唤' },
  monsters:  { zh: '怪物', en: 'Monsters', emblem: '🐺', color1: '#5c2f2f', color2: '#1d0e0e', tagline: '召唤与群体' },
  neutral:   { zh: '中立', en: 'Neutral', emblem: '⚪', color1: '#4a4a4a', color2: '#1a1a1a', tagline: '通用强力卡' },
};

/* ---------------- 领袖（每阵营 4 位，随机抽取） ---------------- */
const LEADERS = {
  northern: [
    { id: 'northern_foltest_king_of_temeria', name: { zh: '弗尔泰斯特·泰莫利亚之王', en: 'Foltest: King of Temeria' }, effect: 'deck_weather_fog', desc: '从牌组取出一张「蔽日浓雾」并使用' },
    { id: 'northern_foltest_lord_commander', name: { zh: '弗尔泰斯特·北方统帅', en: 'Foltest: Lord Commander of the North' }, effect: 'clear_weather', desc: '清除场上所有天气效果' },
    { id: 'northern_foltest_siegemaster', name: { zh: '弗尔泰斯特·围城大师', en: 'Foltest: The Siegemaster' }, effect: 'double_siege', desc: '己方攻城排单位战力翻倍' },
    { id: 'northern_foltest_steel_forged', name: { zh: '弗尔泰斯特·钢铁之躯', en: 'Foltest: The Steel-Forged' }, effect: 'destroy_enemy_siege', desc: '若敌方攻城总战力超过 10，摧毁其全部攻城单位' },
  ],
  nilfgaard: [
    { id: 'nilfgaard_emhyr_his_imperial_majesty', name: { zh: '恩希尔·皇帝陛下', en: 'Emhyr var Emreis: His Imperial Majesty' }, effect: 'deck_weather_rain', desc: '从牌组取出一张「倾盆大雨」并使用' },
    { id: 'nilfgaard_emhyr_emperor_of_nilfgaard', name: { zh: '恩希尔·尼弗迦德皇帝', en: 'Emhyr var Emreis: Emperor of Nilfgaard' }, effect: 'see_opponent_hand', desc: '查看对手手牌中随机 3 张' },
    { id: 'nilfgaard_emhyr_white_flame', name: { zh: '恩希尔·白焰', en: 'Emhyr var Emreis: The White Flame' }, effect: 'cancel_opponent_leader', desc: '使对手的领袖技能失效' },
    { id: 'nilfgaard_emhyr_relentless', name: { zh: '恩希尔·不屈者', en: 'Emhyr var Emreis: The Relentless' }, effect: 'steal_opp_discard', desc: '从对手坟场取一张牌加入自己手牌' },
  ],
  scoiatael: [
    { id: 'scoiatael_francesca_pureblood_elf', name: { zh: '法兰茜丝卡·纯血精灵', en: 'Francesca Findabair: Pureblood Elf' }, effect: 'deck_weather_frost', desc: '从牌组取出一张「刺骨冰霜」并使用' },
    { id: 'scoiatael_francesca_the_beautiful', name: { zh: '法兰茜丝卡·美之化身', en: 'Francesca Findabair: The Beautiful' }, effect: 'double_ranged', desc: '己方远程排单位战力翻倍' },
    { id: 'scoiatael_francesca_daisy_of_the_valley', name: { zh: '法兰茜丝卡·溪谷雏菊', en: 'Francesca Findabair: Daisy of the Valley' }, effect: 'draw_extra_first_round', desc: '第一局开始时额外抽 1 张牌' },
    { id: 'scoiatael_francesca_queen_of_dol_blathanna', name: { zh: '法兰茜丝卡·多尔·布雷坦纳女王', en: 'Francesca Findabair: Queen of Dol Blathanna' }, effect: 'destroy_enemy_melee', desc: '若敌方近战总战力超过 10，摧毁其全部近战单位' },
  ],
  monsters: [
    { id: 'monsters_eredin_commander_of_the_red_riders', name: { zh: '艾瑞汀·赤色骑士统帅', en: 'Eredin: Commander of the Red Riders' }, effect: 'deck_weather_any', desc: '从牌组取出一张天气牌并使用' },
    { id: 'monsters_eredin_bringer_of_death', name: { zh: '艾瑞汀·死亡使者', en: 'Eredin: Bringer of Death' }, effect: 'discard_2_draw_1', desc: '弃掉 2 张牌，然后抽 1 张牌' },
    { id: 'monsters_eredin_destroyer_of_worlds', name: { zh: '艾瑞汀·世界毁灭者', en: 'Eredin: Destroyer of Worlds' }, effect: 'revive_to_hand', desc: '从己方坟场取一张牌加入手牌' },
    { id: 'monsters_eredin_king_of_the_wild_hunt', name: { zh: '艾瑞汀·狂猎之王', en: 'Eredin: King of the Wild Hunt' }, effect: 'double_melee', desc: '己方近战排单位战力翻倍' },
  ],
};

/* ---------------- 卡池 ----------------
 * 字段：id, en, zh, f, t(unit|hero|special), p, row(melee|ranged|siege|agile),
 *       ab[技能], n(实体张数), mg(召唤组)
 */
const CARDS = {
  northern: [
    { id: 'northern_ballista', en: 'Ballista', zh: '弩炮', t: 'unit', p: 6, row: 'siege', n: 2 },
    { id: 'northern_blue_stripes_commando', en: 'Blue Stripes Commando', zh: '蓝衣铁卫突击队', t: 'unit', p: 4, row: 'melee', ab: ['tight_bond'], n: 3 },
    { id: 'northern_catapult', en: 'Catapult', zh: '石弩', t: 'unit', p: 8, row: 'siege', ab: ['tight_bond'], n: 2 },
    { id: 'northern_crinfrid_reavers_dragon_hunter', en: 'Crinfrid Reavers Dragon Hunter', zh: '克林菲德掠夺者·龙猎人', t: 'unit', p: 5, row: 'ranged', ab: ['tight_bond'], n: 3 },
    { id: 'northern_dethmold', en: 'Dethmold', zh: '德思摩', t: 'unit', p: 6, row: 'ranged' },
    { id: 'northern_dun_banner_medic', en: 'Dun Banner Medic', zh: '登班纳军医', t: 'unit', p: 5, row: 'siege', ab: ['medic'] },
    { id: 'northern_esterad_thyssen', en: 'Esterad Thyssen', zh: '埃斯特拉德·提森', t: 'hero', p: 10, row: 'melee' },
    { id: 'northern_john_natalis', en: 'John Natalis', zh: '约翰·纳塔利斯', t: 'hero', p: 10, row: 'melee' },
    { id: 'northern_kaedweni_siege_expert', en: 'Kaedweni Siege Expert', zh: '科德温攻城专家', t: 'unit', p: 1, row: 'siege', ab: ['morale_boost'], n: 3 },
    { id: 'northern_keira_metz', en: 'Keira Metz', zh: '凯拉·梅兹', t: 'unit', p: 5, row: 'ranged' },
    { id: 'northern_philippa_eilhart', en: 'Philippa Eilhart', zh: '菲丽芭·艾哈特', t: 'hero', p: 10, row: 'ranged' },
    { id: 'northern_poor_fucking_infantry', en: 'Poor Fucking Infantry', zh: '可怜的步兵', t: 'unit', p: 1, row: 'melee', ab: ['tight_bond'], n: 4 },
    { id: 'northern_prince_stennis', en: 'Prince Stennis', zh: '斯坦尼斯王子', t: 'unit', p: 5, row: 'melee', ab: ['spy'] },
    { id: 'northern_redanian_foot_soldier', en: 'Redanian Foot Soldier', zh: '瑞达尼亚步兵', t: 'unit', p: 1, row: 'melee', n: 2 },
    { id: 'northern_sabrina_glevissig', en: 'Sabrina Glevissig', zh: '萨宾娜·葛莱维希格', t: 'unit', p: 4, row: 'ranged' },
    { id: 'northern_sheldon_skaggs', en: 'Sheldon Skaggs', zh: '谢尔顿·斯卡格斯', t: 'unit', p: 4, row: 'ranged' },
    { id: 'northern_siege_tower', en: 'Siege Tower', zh: '攻城塔', t: 'unit', p: 6, row: 'siege' },
    { id: 'northern_siegfried_of_denesle', en: 'Siegfried of Denesle', zh: '德内斯勒的齐格菲', t: 'unit', p: 5, row: 'melee' },
    { id: 'northern_sigismund_dijkstra', en: 'Sigismund Dijkstra', zh: '西吉斯蒙德·迪科斯彻', t: 'unit', p: 4, row: 'melee', ab: ['spy'] },
    { id: 'northern_sile_de_tansarville', en: 'Síle de Tansarville', zh: '席儿·德·坦沙维尔', t: 'unit', p: 5, row: 'ranged' },
    { id: 'northern_thaler', en: 'Thaler', zh: '塔勒', t: 'unit', p: 1, row: 'siege', ab: ['spy'] },
    { id: 'northern_trebuchet', en: 'Trebuchet', zh: '投石车', t: 'unit', p: 6, row: 'siege', n: 2 },
    { id: 'northern_vernon_roche', en: 'Vernon Roche', zh: '弗农·罗契', t: 'hero', p: 10, row: 'melee' },
    { id: 'northern_ves', en: 'Ves', zh: '薇丝', t: 'unit', p: 5, row: 'melee' },
    { id: 'northern_yarpen_zigrin', en: 'Yarpen Zigrin', zh: '亚尔潘·齐格林', t: 'unit', p: 2, row: 'melee' },
  ],
  nilfgaard: [
    { id: 'nilfgaard_albrich', en: 'Albrich', zh: '阿尔布里希', t: 'unit', p: 2, row: 'ranged' },
    { id: 'nilfgaard_assire_var_anahid', en: 'Assire var Anahid', zh: '阿西尔·瓦·阿纳希德', t: 'unit', p: 6, row: 'ranged' },
    { id: 'nilfgaard_black_infantry_archer', en: 'Black Infantry Archer', zh: '黑衣步兵弓箭手', t: 'unit', p: 10, row: 'ranged', n: 2 },
    { id: 'nilfgaard_cahir', en: 'Cahir Mawr Dyffryn aep Ceallach', zh: '卡希尔·马乌里·迪夫林·艾普·契拉克', t: 'unit', p: 6, row: 'melee' },
    { id: 'nilfgaard_cynthia', en: 'Cynthia', zh: '辛西娅', t: 'unit', p: 4, row: 'ranged' },
    { id: 'nilfgaard_etolian_auxiliary_archers', en: 'Etolian Auxiliary Archers', zh: '埃托利亚辅助弓箭手', t: 'unit', p: 1, row: 'ranged', ab: ['medic'], n: 2 },
    { id: 'nilfgaard_fringilla_vigo', en: 'Fringilla Vigo', zh: '芙琳吉拉·薇歌', t: 'unit', p: 6, row: 'ranged' },
    { id: 'nilfgaard_heavy_zerrikanian_fire_scorpion', en: 'Heavy Zerrikanian Fire Scorpion', zh: '重型泽瑞卡尼亚火蝎', t: 'unit', p: 10, row: 'siege' },
    { id: 'nilfgaard_impera_brigade_guard', en: 'Impera Brigade Guard', zh: '因佩拉旅卫队', t: 'unit', p: 3, row: 'melee', ab: ['tight_bond'], n: 4 },
    { id: 'nilfgaard_letho_of_gulet', en: 'Letho of Gulet', zh: '雷索', t: 'hero', p: 10, row: 'melee' },
    { id: 'nilfgaard_menno_coehoorn', en: 'Menno Coehoorn', zh: '梅诺·库霍恩', t: 'hero', p: 10, row: 'melee', ab: ['medic'] },
    { id: 'nilfgaard_morteisen', en: 'Morteisen', zh: '莫泰森', t: 'unit', p: 3, row: 'melee' },
    { id: 'nilfgaard_morvran_voorhis', en: 'Morvran Voorhis', zh: '莫尔凡·沃里斯', t: 'hero', p: 10, row: 'siege' },
    { id: 'nilfgaard_nausicaa_cavalry_rider', en: 'Nausicaa Cavalry Rider', zh: '瑙西卡骑兵', t: 'unit', p: 2, row: 'melee', ab: ['tight_bond'], n: 3 },
    { id: 'nilfgaard_puttkammer', en: 'Puttkammer', zh: '普特卡默', t: 'unit', p: 3, row: 'ranged' },
    { id: 'nilfgaard_rainfarn', en: 'Rainfarn', zh: '雷恩法恩', t: 'unit', p: 4, row: 'melee' },
    { id: 'nilfgaard_renuald_aep_matsen', en: 'Renuald aep Matsen', zh: '雷纳德·艾普·马特森', t: 'unit', p: 5, row: 'ranged' },
    { id: 'nilfgaard_rotten_mangonel', en: 'Rotten Mangonel', zh: '腐烂投石机', t: 'unit', p: 3, row: 'siege' },
    { id: 'nilfgaard_shilard_fitz_oesterlen', en: 'Shilard Fitz-Oesterlen', zh: '希拉德·菲茨-奥斯特伦', t: 'unit', p: 7, row: 'melee', ab: ['spy'] },
    { id: 'nilfgaard_siege_engineer', en: 'Siege Engineer', zh: '攻城工程师', t: 'unit', p: 6, row: 'siege' },
    { id: 'nilfgaard_siege_technician', en: 'Siege Technician', zh: '攻城技师', t: 'unit', p: 0, row: 'siege', ab: ['medic'] },
    { id: 'nilfgaard_stefan_skellen', en: 'Stefan Skellen', zh: '斯特凡·斯凯伦', t: 'unit', p: 9, row: 'melee', ab: ['spy'] },
    { id: 'nilfgaard_sweers', en: 'Sweers', zh: '斯维尔斯', t: 'unit', p: 2, row: 'ranged' },
    { id: 'nilfgaard_tibor_eggebracht', en: 'Tibor Eggebracht', zh: '提波尔·艾格布拉杰', t: 'hero', p: 10, row: 'ranged' },
    { id: 'nilfgaard_vanhemar', en: 'Vanhemar', zh: '范海玛', t: 'unit', p: 4, row: 'ranged' },
    { id: 'nilfgaard_vattier_de_rideaux', en: 'Vattier de Rideaux', zh: '瓦提尔·德·李道克斯', t: 'unit', p: 4, row: 'melee', ab: ['spy'] },
    { id: 'nilfgaard_vreemde', en: 'Vreemde', zh: '弗雷姆德', t: 'unit', p: 2, row: 'melee' },
    { id: 'nilfgaard_young_emissary', en: 'Young Emissary', zh: '年轻使者', t: 'unit', p: 5, row: 'melee', ab: ['tight_bond'], n: 2 },
    { id: 'nilfgaard_zerrikanian_fire_scorpion', en: 'Zerrikanian Fire Scorpion', zh: '泽瑞卡尼亚火蝎', t: 'unit', p: 5, row: 'siege' },
  ],
  scoiatael: [
    { id: 'scoiatael_barclay_els', en: 'Barclay Els', zh: '巴克利·埃尔斯', t: 'unit', p: 6, row: 'agile' },
    { id: 'scoiatael_ciaran_aep_easnillien', en: 'Ciaran aep Easnillien', zh: '希亚兰·艾普·伊斯尼连', t: 'unit', p: 3, row: 'agile' },
    { id: 'scoiatael_dennis_cranmer', en: 'Dennis Cranmer', zh: '丹尼斯·克莱默', t: 'unit', p: 6, row: 'melee' },
    { id: 'scoiatael_dol_blathanna_archer', en: 'Dol Blathanna Archer', zh: '多尔·布雷坦纳弓箭手', t: 'unit', p: 4, row: 'ranged' },
    { id: 'scoiatael_dol_blathanna_scout', en: 'Dol Blathanna Scout', zh: '多尔·布雷坦纳斥候', t: 'unit', p: 6, row: 'agile', n: 3 },
    { id: 'scoiatael_dwarven_skirmisher', en: 'Dwarven Skirmisher', zh: '矮人散兵', t: 'unit', p: 3, row: 'melee', ab: ['muster'], n: 3, mg: 'dwarven_skirmisher' },
    { id: 'scoiatael_eithne', en: 'Eithné', zh: '艾思娜', t: 'hero', p: 10, row: 'ranged' },
    { id: 'scoiatael_elven_skirmisher', en: 'Elven Skirmisher', zh: '精灵散兵', t: 'unit', p: 2, row: 'ranged', ab: ['muster'], n: 3, mg: 'elven_skirmisher' },
    { id: 'scoiatael_filavandrel_aen_fidhail', en: 'Filavandrel aen Fidhail', zh: '菲拉万德雷尔', t: 'unit', p: 6, row: 'agile' },
    { id: 'scoiatael_havekar_healer', en: 'Havekar Healer', zh: '哈维卡医师', t: 'unit', p: 0, row: 'ranged', ab: ['medic'], n: 3 },
    { id: 'scoiatael_havekar_smuggler', en: 'Havekar Smuggler', zh: '哈维卡走私者', t: 'unit', p: 5, row: 'melee', ab: ['muster'], n: 3, mg: 'havekar_smuggler' },
    { id: 'scoiatael_ida_emean_aep_sivney', en: 'Ida Emean aep Sivney', zh: '伊达·埃米安', t: 'unit', p: 6, row: 'ranged' },
    { id: 'scoiatael_iorveth', en: 'Iorveth', zh: '伊欧菲斯', t: 'hero', p: 10, row: 'ranged' },
    { id: 'scoiatael_isengrim_faoiltiarna', en: 'Isengrim Faoiltiarna', zh: '伊森格林·法欧提亚纳', t: 'hero', p: 10, row: 'melee', ab: ['morale_boost'] },
    { id: 'scoiatael_mahakaman_defender', en: 'Mahakaman Defender', zh: '玛哈坎守卫', t: 'unit', p: 5, row: 'melee', n: 5 },
    { id: 'scoiatael_milva', en: 'Milva', zh: '米尔瓦', t: 'unit', p: 10, row: 'ranged', ab: ['morale_boost'] },
    { id: 'scoiatael_riordain', en: 'Riordain', zh: '瑞奥丹', t: 'unit', p: 1, row: 'ranged' },
    { id: 'scoiatael_saesenthessis', en: 'Saesenthessis', zh: '萨琪亚（龙形）', t: 'hero', p: 10, row: 'ranged' },
    { id: 'scoiatael_toruviel', en: 'Toruviel', zh: '托露薇尔', t: 'unit', p: 2, row: 'ranged' },
    { id: 'scoiatael_vrihedd_brigade_recruit', en: 'Vrihedd Brigade Recruit', zh: '维里赫德旅新兵', t: 'unit', p: 4, row: 'ranged' },
    { id: 'scoiatael_vrihedd_brigade_veteran', en: 'Vrihedd Brigade Veteran', zh: '维里赫德旅老兵', t: 'unit', p: 5, row: 'agile', n: 2 },
    { id: 'scoiatael_yaevinn', en: 'Yaevinn', zh: '亚伊文', t: 'unit', p: 6, row: 'agile' },
  ],
  monsters: [
    { id: 'monsters_arachas', en: 'Arachas', zh: '阿拉哈斯', t: 'unit', p: 4, row: 'melee', ab: ['muster'], n: 3, mg: 'arachas' },
    { id: 'monsters_arachas_behemoth', en: 'Arachas Behemoth', zh: '阿拉哈斯巨兽', t: 'unit', p: 6, row: 'siege', ab: ['muster'], mg: 'arachas' },
    { id: 'monsters_botchling', en: 'Botchling', zh: '畸形怪', t: 'unit', p: 4, row: 'melee' },
    { id: 'monsters_celaeno_harpy', en: 'Celaeno Harpy', zh: '塞莱诺鹰身女妖', t: 'unit', p: 2, row: 'agile' },
    { id: 'monsters_cockatrice', en: 'Cockatrice', zh: '鸡蛇兽', t: 'unit', p: 2, row: 'ranged' },
    { id: 'monsters_crone_brewess', en: 'Crone: Brewess', zh: '老巫妪·煮婆', t: 'unit', p: 6, row: 'melee', ab: ['muster'], mg: 'crone' },
    { id: 'monsters_crone_weavess', en: 'Crone: Weavess', zh: '老巫妪·织婆', t: 'unit', p: 6, row: 'melee', ab: ['muster'], mg: 'crone' },
    { id: 'monsters_crone_whispess', en: 'Crone: Whispess', zh: '老巫妪·呢喃婆', t: 'unit', p: 6, row: 'melee', ab: ['muster'], mg: 'crone' },
    { id: 'monsters_draug', en: 'Draug', zh: '德劳格', t: 'hero', p: 10, row: 'melee' },
    { id: 'monsters_earth_elemental', en: 'Earth Elemental', zh: '土元素', t: 'unit', p: 6, row: 'siege' },
    { id: 'monsters_endrega', en: 'Endrega', zh: '安德莱格', t: 'unit', p: 2, row: 'ranged' },
    { id: 'monsters_fiend', en: 'Fiend', zh: '恶魔', t: 'unit', p: 6, row: 'melee' },
    { id: 'monsters_fire_elemental', en: 'Fire Elemental', zh: '火元素', t: 'unit', p: 6, row: 'siege' },
    { id: 'monsters_foglet', en: 'Foglet', zh: '雾妖', t: 'unit', p: 2, row: 'melee' },
    { id: 'monsters_forktail', en: 'Forktail', zh: '叉尾龙', t: 'unit', p: 5, row: 'melee' },
    { id: 'monsters_frightener', en: 'Frightener', zh: '恐惧怪', t: 'unit', p: 5, row: 'melee' },
    { id: 'monsters_gargoyle', en: 'Gargoyle', zh: '石像鬼', t: 'unit', p: 2, row: 'ranged' },
    { id: 'monsters_ghoul', en: 'Ghoul', zh: '食尸鬼', t: 'unit', p: 1, row: 'melee', ab: ['muster'], n: 3, mg: 'ghoul' },
    { id: 'monsters_grave_hag', en: 'Grave Hag', zh: '墓穴老妇', t: 'unit', p: 5, row: 'ranged' },
    { id: 'monsters_griffin', en: 'Griffin', zh: '狮鹫', t: 'unit', p: 5, row: 'melee' },
    { id: 'monsters_harpy', en: 'Harpy', zh: '鹰身女妖', t: 'unit', p: 2, row: 'agile' },
    { id: 'monsters_ice_giant', en: 'Ice Giant', zh: '冰霜巨人', t: 'unit', p: 5, row: 'siege' },
    { id: 'monsters_imlerith', en: 'Imlerith', zh: '伊勒瑞斯', t: 'hero', p: 10, row: 'melee' },
    { id: 'monsters_kayran', en: 'Kayran', zh: '凯兰', t: 'hero', p: 8, row: 'agile', ab: ['morale_boost'] },
    { id: 'monsters_leshen', en: 'Leshen', zh: '林精', t: 'hero', p: 10, row: 'ranged' },
    { id: 'monsters_nekker', en: 'Nekker', zh: '掘地虫', t: 'unit', p: 2, row: 'melee', ab: ['muster'], n: 3, mg: 'nekker' },
    { id: 'monsters_plague_maiden', en: 'Plague Maiden', zh: '瘟疫少女', t: 'unit', p: 5, row: 'melee' },
    { id: 'monsters_vampire_bruxa', en: 'Vampire: Bruxa', zh: '吸血鬼·布鲁萨', t: 'unit', p: 4, row: 'melee', ab: ['muster'], mg: 'vampire' },
    { id: 'monsters_vampire_ekimmara', en: 'Vampire: Ekimmara', zh: '吸血鬼·艾基玛拉', t: 'unit', p: 4, row: 'melee', ab: ['muster'], mg: 'vampire' },
    { id: 'monsters_vampire_fleder', en: 'Vampire: Fleder', zh: '吸血鬼·弗莱德', t: 'unit', p: 4, row: 'melee', ab: ['muster'], mg: 'vampire' },
    { id: 'monsters_vampire_garkain', en: 'Vampire: Garkain', zh: '吸血鬼·加尔坎', t: 'unit', p: 4, row: 'melee', ab: ['muster'], mg: 'vampire' },
    { id: 'monsters_vampire_katakan', en: 'Vampire: Katakan', zh: '吸血鬼·卡塔坎', t: 'unit', p: 5, row: 'melee', ab: ['muster'], mg: 'vampire' },
    { id: 'monsters_werewolf', en: 'Werewolf', zh: '狼人', t: 'unit', p: 5, row: 'melee' },
    { id: 'monsters_wyvern', en: 'Wyvern', zh: '双足飞龙', t: 'unit', p: 2, row: 'ranged' },
  ],
  neutral: [
    { id: 'neutral_geralt_of_rivia', en: 'Geralt of Rivia', zh: '利维亚的杰洛特', t: 'hero', p: 15, row: 'melee' },
    { id: 'neutral_cirilla_fiona_elen_riannon', en: 'Cirilla Fiona Elen Riannon', zh: '希里雅', t: 'hero', p: 15, row: 'melee' },
    { id: 'neutral_triss_merigold', en: 'Triss Merigold', zh: '特莉丝·梅莉葛德', t: 'hero', p: 7, row: 'melee' },
    { id: 'neutral_yennefer_of_vengerberg', en: 'Yennefer of Vengerberg', zh: '温格堡的叶奈法', t: 'hero', p: 7, row: 'ranged', ab: ['medic'] },
    { id: 'neutral_mysterious_elf', en: 'Mysterious Elf', zh: '神秘精灵', t: 'hero', p: 0, row: 'melee', ab: ['spy'] },
    { id: 'neutral_dandelion', en: 'Dandelion', zh: '丹德里恩', t: 'unit', p: 2, row: 'melee', ab: ['commanders_horn'] },
    { id: 'neutral_zoltan_chivay', en: 'Zoltan Chivay', zh: '卓尔坦·齐瓦', t: 'unit', p: 5, row: 'melee' },
    { id: 'neutral_vesemir', en: 'Vesemir', zh: '维瑟米尔', t: 'unit', p: 6, row: 'melee' },
    { id: 'neutral_villentretenmerth', en: 'Villentretenmerth', zh: '金龙', t: 'unit', p: 7, row: 'melee', ab: ['scorch'] },
    { id: 'neutral_emiel_regis_rohellec_terzieff', en: 'Emiel Regis Rohellec Terzieff', zh: '艾米尔·雷吉斯', t: 'unit', p: 5, row: 'melee' },
  ],
  special: [
    { id: 'special_decoy', en: 'Decoy', zh: '诱饵', t: 'special', kind: 'decoy', icon: '🎭', n: 3, desc: '把己方场上一个非英雄单位收回手牌' },
    { id: 'special_commanders_horn', en: "Commander's Horn", zh: '指挥官号角', t: 'special', kind: 'horn', icon: '🎺', n: 3, desc: '指定己方一排：该排非英雄单位 ×2' },
    { id: 'special_scorch', en: 'Scorch', zh: '焚风', t: 'special', kind: 'scorch', icon: '🔥', n: 3, desc: '若全场总战力 >10，摧毁双方战力最高的非英雄单位' },
    { id: 'special_biting_frost', en: 'Biting Frost', zh: '刺骨冰霜', t: 'special', kind: 'weather', weatherKey: 'frost', icon: '❄️', n: 3, desc: '近战排非英雄单位降为 1' },
    { id: 'special_impenetrable_fog', en: 'Impenetrable Fog', zh: '蔽日浓雾', t: 'special', kind: 'weather', weatherKey: 'fog', icon: '🌫️', n: 3, desc: '远程排非英雄单位降为 1' },
    { id: 'special_torrential_rain', en: 'Torrential Rain', zh: '倾盆大雨', t: 'special', kind: 'weather', weatherKey: 'rain', icon: '🌧️', n: 3, desc: '攻城排非英雄单位降为 1' },
    { id: 'special_clear_weather', en: 'Clear Weather', zh: '天晴', t: 'special', kind: 'clear', icon: '☀️', n: 3, desc: '清除所有天气效果' },
  ],
};

/* 技能说明（中文，UI 提示用） */
const ABILITY_CN = {
  spy: '间谍：置于对方场上（计入对方战力），你抽 2 张牌',
  medic: '医生：出场时可从己方坟场复活一张单位',
  tight_bond: '同袍：同行同名每多一张，每张贡献再叠一倍',
  muster: '召唤：牌组中同组卡牌全部自动上场',
  morale_boost: '鼓舞：己方同行其它单位 +1 战力',
  commanders_horn: '号角：所在排己方非英雄单位 ×2',
  scorch: '焚风：出场时摧毁全场最强非英雄单位',
};

/* ---------------- 卡牌对象化 ---------------- */
let _uid = 1;
function makeCard(def) {
  const c = Object.assign({}, def, {
    defId: def.id,
    uid: _uid++,
    type: def.t || def.type,
    power: def.p != null ? def.p : def.power,
    ability: (def.ab && def.ab[0]) || def.ability || null,
    abilities: def.ab || (def.ability ? [def.ability] : []),
    count: def.n || def.count || 1,
    name: def.name || { zh: def.zh || def.en, en: def.en || def.zh },
    placedRow: null, owner: null, inGrave: false,
    art: (typeof cardArt === 'function' ? cardArt(def) : null) || null,
  });
  return c;
}

/* ---------------- 全局卡牌注册表 ---------------- */
const ALL_CARDS = {};          // defId -> def（含 faction 与本地卡面）
const _art = (def) => (typeof cardArt === 'function' ? cardArt(def) : null) || null;
for (const fac of ['northern', 'nilfgaard', 'scoiatael', 'monsters']) {
  for (const def of CARDS[fac]) ALL_CARDS[def.id] = Object.assign({}, def, { faction: fac, art: _art(def) });
}
for (const def of CARDS.neutral) ALL_CARDS[def.id] = Object.assign({}, def, { faction: 'neutral', art: _art(def) });
for (const def of CARDS.special) ALL_CARDS[def.id] = Object.assign({}, def, { faction: 'neutral', t: 'special', art: _art(def) });
// 领袖也挂上卡面（卡组编辑器直接渲染原始 LEADERS 定义）
for (const fac of Object.keys(LEADERS)) {
  for (const l of LEADERS[fac]) if (!l.art) l.art = _art(l);
}

/* ---------------- 组牌规则（巫师3 原版） ---------------- */
const DECK_RULES = { minUnits: 22, maxUnits: 40, maxSpecials: 10, mulligan: 2 };

/* ---------------- 难度 ---------------- */
const DIFFICULTIES = {
  easy:   { key: 'easy',   zh: '简单', en: 'Easy',   skill: 0.15, desc: 'AI 常犯错：乱出牌、过早过牌、几乎不用领袖技' },
  normal: { key: 'normal', zh: '普通', en: 'Normal', skill: 0.5,  desc: 'AI 按战力出牌，偶尔判断失误' },
  hard:   { key: 'hard',   zh: '困难', en: 'Hard',   skill: 0.8,  desc: 'AI 会算牌差、保关键牌、适时过牌与用领袖技' },
  master: { key: 'master', zh: '大师', en: 'Master', skill: 1.0,  desc: 'AI 全强度：精确过牌、间谍/医生/同袍连锁、天气压制' },
};
const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'master'];

/* ---------------- 组牌：价值评估 / 自动挑选 ---------------- */
function cardValueScore(c) {
  let s = c.power || 0;
  if (c.type === 'hero') s += 1000;
  if (c.ability === 'spy') s += 500;
  if (c.ability === 'medic') s += 300;
  if (c.ability === 'muster') s += 200;
  if (c.ability === 'commanders_horn') s += 150;
  if (c.ability === 'morale_boost') s += 60;
  if (c.ability === 'tight_bond') s += 40;
  return s;
}

/** 自动挑选卡组（保证合法：单位 22–40、特殊牌 ≤10）→ {defId: count}
 *  tier: 'weak' 用最差的牌凑数（简单 AI）/ 其它用最强组合
 */
function autoPicks(factionKey, tier) {
  const picks = {};
  const units = [];
  const pool = CARDS[factionKey].concat(CARDS.neutral);
  for (const def of pool) for (let i = 0; i < (def.n || 1); i++) units.push(def);

  if (tier === 'weak') {
    // 简单 AI：只带最弱的 24 张单位 + 3 张特殊牌（牌库更薄、战力更低）
    units.sort((a, b) => cardValueScore(a) - cardValueScore(b));
    for (const def of units.slice(0, 24)) picks[def.id] = (picks[def.id] || 0) + 1;
    for (const def of CARDS.special.slice(0, 3)) picks[def.id] = (picks[def.id] || 0) + 1;
    return picks;
  }

  units.sort((a, b) => cardValueScore(b) - cardValueScore(a));
  for (const def of units.slice(0, DECK_RULES.maxUnits)) picks[def.id] = (picks[def.id] || 0) + 1;
  for (const def of CARDS.special) picks[def.id] = (picks[def.id] || 0) + 1;
  return picks;
}

/** 校验卡组 → {ok, errors[], unitCount, specialCount, total} */
function validatePicks(factionKey, picks) {
  const errors = [];
  let unitCount = 0, specialCount = 0;
  for (const [defId, n] of Object.entries(picks || {})) {
    if (!n) continue;
    const def = ALL_CARDS[defId];
    if (!def) { errors.push(`未知卡牌：${defId}`); continue; }
    if (!(def.faction === 'neutral' || def.faction === factionKey)) { errors.push(`「${def.zh}」不属于该阵营`); continue; }
    if (n > (def.n || 1)) errors.push(`「${def.zh}」最多 ${def.n || 1} 张（已选 ${n}）`);
    if (def.t === 'special') specialCount += n; else unitCount += n;
  }
  if (unitCount < DECK_RULES.minUnits) errors.push(`单位牌不足：${unitCount}/${DECK_RULES.minUnits}`);
  if (unitCount > DECK_RULES.maxUnits) errors.push(`单位牌超编：${unitCount}/${DECK_RULES.maxUnits}`);
  if (specialCount > DECK_RULES.maxSpecials) errors.push(`特殊牌超编：${specialCount}/${DECK_RULES.maxSpecials}`);
  return { ok: errors.length === 0, errors, unitCount, specialCount, total: unitCount + specialCount };
}

/* ---------------- 牌组构建 ---------------- */
function buildCustomDeck(factionKey, leaderId, picks) {
  const cards = [];
  for (const [defId, n] of Object.entries(picks || {})) {
    const def = ALL_CARDS[defId];
    if (!def || !n) continue;
    for (let i = 0; i < n; i++) cards.push(makeCard(Object.assign({}, def, { faction: def.faction || factionKey })));
  }
  const leaders = LEADERS[factionKey];
  const raw = leaders.find(l => l.id === leaderId) || leaders[0];
  const leader = Object.assign({}, raw);
  leader.type = 'leader';
  leader.faction = factionKey;
  leader.art = (typeof cardArt === 'function' ? cardArt(leader) : null) || null;
  return { faction: factionKey, leader, cards };
}

/** 自动组牌（AI 用 / 玩家一键填充） */
function buildDeck(factionKey, opts) {
  const leaderId = (opts && opts.leaderId) ||
    LEADERS[factionKey][Math.floor(Math.random() * LEADERS[factionKey].length)].id;
  return buildCustomDeck(factionKey, leaderId, autoPicks(factionKey, opts && opts.tier));
}
