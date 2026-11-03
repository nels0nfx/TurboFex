// Phone dial codes of the countries, built into the bot (so dialcode never depends on a website).
// Each row: name (other names after a /) | 2-letter country code | dial code without the plus.
// The Caribbean and a few other places share +1 with a 3 digit area code (for example Jamaica is +1 876): they are written together.
const ROWS = `Afghanistan|AF|93
Albania|AL|355
Algeria|DZ|213
American Samoa|AS|1684
Andorra|AD|376
Angola|AO|244
Anguilla|AI|1264
Antarctica|AQ|672
Antigua and Barbuda|AG|1268
Argentina|AR|54
Armenia|AM|374
Aruba|AW|297
Australia|AU|61
Austria|AT|43
Azerbaijan|AZ|994
Bahamas|BS|1242
Bahrain|BH|973
Bangladesh|BD|880
Barbados|BB|1246
Belarus|BY|375
Belgium|BE|32
Belize|BZ|501
Benin|BJ|229
Bermuda|BM|1441
Bhutan|BT|975
Bolivia|BO|591
Bosnia and Herzegovina/Bosnia|BA|387
Botswana|BW|267
Brazil|BR|55
British Virgin Islands|VG|1284
Brunei|BN|673
Bulgaria|BG|359
Burkina Faso|BF|226
Burundi|BI|257
Cambodia|KH|855
Cameroon|CM|237
Canada|CA|1
Cape Verde/Cabo Verde|CV|238
Cayman Islands|KY|1345
Central African Republic|CF|236
Chad|TD|235
Chile|CL|56
China|CN|86
Christmas Island|CX|61
Cocos Islands|CC|61
Colombia|CO|57
Comoros|KM|269
Congo/Republic of the Congo/Congo-Brazzaville|CG|242
DR Congo/Democratic Republic of the Congo/Congo-Kinshasa|CD|243
Cook Islands|CK|682
Costa Rica|CR|506
Ivory Coast/Cote d'Ivoire|CI|225
Croatia|HR|385
Cuba|CU|53
Curacao|CW|599
Cyprus|CY|357
Czech Republic/Czechia|CZ|420
Denmark|DK|45
Djibouti|DJ|253
Dominica|DM|1767
Dominican Republic|DO|1809
Ecuador|EC|593
Egypt|EG|20
El Salvador|SV|503
Equatorial Guinea|GQ|240
Eritrea|ER|291
Estonia|EE|372
Eswatini/Swaziland|SZ|268
Ethiopia|ET|251
Falkland Islands|FK|500
Faroe Islands|FO|298
Fiji|FJ|679
Finland|FI|358
France|FR|33
French Guiana|GF|594
French Polynesia|PF|689
Gabon|GA|241
Gambia|GM|220
Georgia|GE|995
Germany|DE|49
Ghana|GH|233
Gibraltar|GI|350
Greece|GR|30
Greenland|GL|299
Grenada|GD|1473
Guadeloupe|GP|590
Guam|GU|1671
Guatemala|GT|502
Guernsey|GG|44
Guinea|GN|224
Guinea-Bissau|GW|245
Guyana|GY|592
Haiti|HT|509
Honduras|HN|504
Hong Kong|HK|852
Hungary|HU|36
Iceland|IS|354
India|IN|91
Indonesia|ID|62
Iran|IR|98
Iraq|IQ|964
Ireland|IE|353
Isle of Man|IM|44
Israel|IL|972
Italy|IT|39
Jamaica|JM|1876
Japan|JP|81
Jersey|JE|44
Jordan|JO|962
Kazakhstan|KZ|7
Kenya|KE|254
Kiribati|KI|686
Kosovo|XK|383
Kuwait|KW|965
Kyrgyzstan|KG|996
Laos|LA|856
Latvia|LV|371
Lebanon|LB|961
Lesotho|LS|266
Liberia|LR|231
Libya|LY|218
Liechtenstein|LI|423
Lithuania|LT|370
Luxembourg|LU|352
Macau/Macao|MO|853
Madagascar|MG|261
Malawi|MW|265
Malaysia|MY|60
Maldives|MV|960
Mali|ML|223
Malta|MT|356
Marshall Islands|MH|692
Martinique|MQ|596
Mauritania|MR|222
Mauritius|MU|230
Mayotte|YT|262
Mexico|MX|52
Micronesia|FM|691
Moldova|MD|373
Monaco|MC|377
Mongolia|MN|976
Montenegro|ME|382
Montserrat|MS|1664
Morocco|MA|212
Mozambique|MZ|258
Myanmar/Burma|MM|95
Namibia|NA|264
Nauru|NR|674
Nepal|NP|977
Netherlands/Holland|NL|31
New Caledonia|NC|687
New Zealand|NZ|64
Nicaragua|NI|505
Niger|NE|227
Nigeria|NG|234
Niue|NU|683
Norfolk Island|NF|672
North Korea|KP|850
North Macedonia/Macedonia|MK|389
Northern Mariana Islands|MP|1670
Norway|NO|47
Oman|OM|968
Pakistan|PK|92
Palau|PW|680
Palestine|PS|970
Panama|PA|507
Papua New Guinea|PG|675
Paraguay|PY|595
Peru|PE|51
Philippines|PH|63
Poland|PL|48
Portugal|PT|351
Puerto Rico|PR|1787
Qatar|QA|974
Reunion|RE|262
Romania|RO|40
Russia|RU|7
Rwanda|RW|250
Saint Helena|SH|290
Saint Kitts and Nevis|KN|1869
Saint Lucia|LC|1758
Saint Martin|MF|590
Saint Pierre and Miquelon|PM|508
Saint Vincent and the Grenadines|VC|1784
Samoa|WS|685
San Marino|SM|378
Sao Tome and Principe|ST|239
Saudi Arabia|SA|966
Senegal|SN|221
Serbia|RS|381
Seychelles|SC|248
Sierra Leone|SL|232
Singapore|SG|65
Sint Maarten|SX|1721
Slovakia|SK|421
Slovenia|SI|386
Solomon Islands|SB|677
Somalia|SO|252
South Africa|ZA|27
South Korea/Korea|KR|82
South Sudan|SS|211
Spain|ES|34
Sri Lanka|LK|94
Sudan|SD|249
Suriname|SR|597
Svalbard|SJ|47
Sweden|SE|46
Switzerland|CH|41
Syria|SY|963
Taiwan|TW|886
Tajikistan|TJ|992
Tanzania|TZ|255
Thailand|TH|66
Timor-Leste/East Timor|TL|670
Togo|TG|228
Tokelau|TK|690
Tonga|TO|676
Trinidad and Tobago|TT|1868
Tunisia|TN|216
Turkey/Turkiye|TR|90
Turkmenistan|TM|993
Turks and Caicos Islands|TC|1649
Tuvalu|TV|688
Uganda|UG|256
Ukraine|UA|380
United Arab Emirates/UAE|AE|971
United Kingdom/UK/Britain/England/Great Britain|GB|44
United States/USA/US/America|US|1
Uruguay|UY|598
US Virgin Islands|VI|1340
Uzbekistan|UZ|998
Vanuatu|VU|678
Vatican City/Vatican|VA|379
Venezuela|VE|58
Vietnam/Viet Nam|VN|84
Wallis and Futuna|WF|681
Western Sahara|EH|212
Yemen|YE|967
Zambia|ZM|260
Zimbabwe|ZW|263`;

const flag = (iso) => (/^[A-Z]{2}$/.test(iso) && iso !== 'XK' ? String.fromCodePoint(...[...iso].map((c) => 127397 + c.charCodeAt(0))) : '🌍');
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const COUNTRIES = ROWS.split('\n').map((row) => {
  const [names, iso, code] = row.split('|');
  const list = names.split('/');
  return { name: list[0], names: list.map(plain), iso, code, flag: flag(iso) };
});

// the country for a name or a 2-letter code: an exact name, then the start of a name, then a name that contains the words
function byName(query) {
  const q = plain(query);
  if (!q) return null;
  if (/^[a-z]{2}$/.test(q)) {
    const hit = COUNTRIES.find((c) => c.iso.toLowerCase() === q);
    if (hit) return hit;
  }
  return COUNTRIES.find((c) => c.names.includes(q)) || COUNTRIES.find((c) => c.names.some((n) => n.startsWith(q))) || (q.length >= 4 ? COUNTRIES.find((c) => c.names.some((n) => n.includes(q))) : null) || null;
}

// the countries of a dial code, with or without the plus: "234", "+44", "1876"
function byCode(digits) {
  const d = String(digits).replace(/\D/g, '');
  if (!d) return [];
  const exact = COUNTRIES.filter((c) => c.code === d);
  if (exact.length) return exact;
  return d.length > 1 ? COUNTRIES.filter((c) => c.code.startsWith(d)) : [];
}

// "+254", "+1 876": the code as people write it
const show = (c) => (c.code.length === 4 && c.code[0] === '1' ? `+1 ${c.code.slice(1)}` : `+${c.code}`);

module.exports = { COUNTRIES, byName, byCode, show };
