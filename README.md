# Discord Setup Bot

Een Discord-bot die complete servers inricht vanuit JSON-templates: rollen, categorieen,
kanalen, permissie-overwrites en serverinstellingen — in een keer, reproduceerbaar.

## Wat de bot doet

| Commando | Wat het doet |
| --- | --- |
| `/setup list` | Toont alle beschikbare templates met aantallen rollen/kanalen |
| `/setup preview template:<naam>` | Laat het volledige plan zien **zonder iets te wijzigen** |
| `/setup apply template:<naam> bevestig:<servernaam>` | Voert het plan uit |
| `/setup export` | Exporteert de huidige server als template-bestand (JSON-bijlage) |

Hetzelfde kan lokaal via het dashboard (`npm run dashboard`), inclusief het bewerken van
templates.

Bij het joinen van een server controleert de bot zichzelf en post hij een kort bericht:
of hij klaar is voor gebruik, of precies welk recht ontbreekt met een link die het herstelt.

Alle antwoorden zijn ephemeral (alleen zichtbaar voor degene die het commando uitvoert).
Het commando is standaard alleen beschikbaar voor leden met **Server beheren**.

### Veiligheid

- **Idempotent**: bestaande rollen en kanalen worden op naam herkend en niet nog een keer
  aangemaakt. Twee keer `apply` draaien levert dezelfde server op.
- **Preview eerst**: `/setup preview` toont exact welke acties zouden draaien.
- **Bevestiging verplicht**: `apply` vraagt om de servernaam letterlijk over te typen.
- **Verwijderen is opt-in**: zonder `prune:true` wordt er nooit iets verwijderd.
- **Rechtencheck vooraf**: de bot controleert of hij zelf Kanalen beheren, Rollen beheren en
  Server beheren heeft voordat hij begint.
- **De bot sluit zichzelf niet buiten**: verstopt een template een kanaal voor `@everyone`, dan
  zet hij er een uitzondering voor zichzelf bij. Zonder dat kan hij zijn eigen kanalen daarna
  niet meer bijwerken of opruimen — hij hoort immers ook bij `@everyone`.

## Installatie

```bash
npm install
cp .env.example .env      # vul DISCORD_TOKEN en DISCORD_CLIENT_ID in
npm run configure-install # zet de rechten die de bot bij elke join krijgt
npm run deploy            # registreert de slash commands
npm run dev               # of: npm run build && npm start
```

### Bot aanmaken en uitnodigen

1. Maak een applicatie op <https://discord.com/developers/applications>.
2. Tabblad **Bot** → *Reset Token* → zet de token in `.env` als `DISCORD_TOKEN`.
   Het Application ID (tabblad *General Information*) is `DISCORD_CLIENT_ID`.
3. Draai `npm run configure-install`. Vanaf dat moment vraagt elke manier om de bot toe te
   voegen automatisch de juiste rechten — ook de **Add App**-knop op het profiel van de bot
   en in de App Directory. Je hoeft geen handgemaakte link meer rond te sturen.
4. `npm run invite` print de invite-link als je er toch een wilt delen.
5. Zet de rol van de bot in de rollenlijst **boven** de rollen die hij moet beheren —
   Discord staat niet toe dat een bot rollen aanmaakt of aanpast boven zijn eigen rol.
   De bot waarschuwt hier zelf voor als hij een server binnenkomt.

## Rechten bij het joinen

Een bot kan zichzelf **geen** rechten geven: Discord legt ze vast op het moment van de
invite en staat geen escalatie achteraf toe. Wat wel automatisch kan, doet dit project:

- **Default install-settings** (`npm run configure-install`) zetten de gevraagde rechten
  vast op de applicatie zelf. Elke join daarna maakt de beheerde rol van de bot direct met
  de juiste permissies aan — zonder dat iemand vinkjes hoeft te zetten.
- **Zelfcontrole bij binnenkomst**: mist de bot toch iets (iemand heeft vinkjes uitgezet,
  of hij is met een oude link toegevoegd), dan post hij meteen wat er ontbreekt met een
  herstel-link. Opnieuw autoriseren werkt de bestaande rol bij; de bot hoeft er niet uit.
- **Eén bron voor de lijst**: `src/botPermissions.ts`. De invite-link, de install-settings,
  de controle bij het joinen en de check in `/setup apply` lezen daar allemaal uit, dus ze
  kunnen niet uit elkaar lopen. Wil je er een recht bij? Voeg het daar toe en draai
  `npm run configure-install` opnieuw.

### Waarom Administrator

De invite-link vraagt **Administrator**. Dat is geen gemakzucht — het zijn twee regels van
Discord waar niet omheen te komen is:

1. **Een bot mag geen recht uitdelen dat hij zelf niet heeft.** Een rol met `KickMembers`
   aanmaken lukt alleen als de bot zelf mag kicken. Hetzelfde geldt voor de rechten die je
   per kanaal aan- of uitzet. Een template met een beheerdersrol vraagt dus een bot met
   Administrator.
2. **Community-modus aanzetten vraagt Administrator.** Niets minder, ook niet met
   `ManageGuild`. En zonder community-modus bestaan forum-, aankondigings- en
   stagekanalen niet.

### Zonder Administrator: hij doet wat hij kan

Heeft de bot geen Administrator, dan **stopt hij niet en mislukt er niets**. Het plan wordt
vóór de eerste wijziging bijgesteld naar wat deze bot op deze server echt mag, en daarna
staat er precies wat er is bijgesteld:

```
Bijgesteld naar wat deze bot kan:
  rol @Clan Owner: Administrator niet gezet (de bot heeft dat zelf niet).
  rol @Officier: KickMembers, ManageMessages niet gezet (de bot heeft dat zelf niet).
  community-modus overgeslagen: dat aanzetten vraagt Administrator.
  4 forum-, aankondigings- of stagekanalen overgeslagen: die bestaan alleen op een
  community-server.
  Geef de bot Administrator en draai dit opnieuw, dan worden deze dingen alsnog gezet.
```

Je krijgt dus een server die klopt op alles wat kon, met een lijstje van wat niet kon. Geef
je de bot daarna Administrator en draai je het opnieuw, dan worden die rollen bijgewerkt en
de ontbrekende kanalen gemaakt — je hoeft niets opnieuw te doen.

Wat er nooit gebeurt: een recht stilletjes weghalen. Heeft een bestaande rol een permissie
die de bot zelf niet heeft, dan blijft die staan zoals hij stond.

Dit geldt voor elke template, ook eentje die jij morgen maakt: een test loopt alle templates
in de map langs, met vier verschillende bot-rechten, en eist dat het bijgestelde plan nooit
iets vraagt wat de bot niet mag. De controle (`npm run dashboard` → Controle) zegt er
bovendien bij of een template Administrator vraagt.

Wil je liever dat hij stopt in plaats van bijstelt: `--stop-bij-tekort`, of het vinkje
*Stoppen zodra de bot iets niet mag* in de Action.

De beperkte invite-link uit `npm run invite` is genoeg voor templates zonder community-modus
en zonder rollen met bijzondere rechten: `ManageChannels`, `ManageRoles`, `ManageGuild` plus
`ViewChannel`, `SendMessages`, `EmbedLinks`, `AttachFiles`, `ReadMessageHistory`.

## Naam van de bot

De naam staat op drie plekken in Discord, en ze zijn niet allemaal hetzelfde:

| Waar | Wat het is | Hoe je het zet |
| --- | --- | --- |
| **Gebruikersnaam** | wat in de ledenlijst en boven berichten staat | `BOT_NAME` in `.env` + `npm run configure-install` |
| **Applicatienaam** | de titel op het autorisatiescherm en in de App Directory | Developer Portal → General Information → Name |
| **Servernickname** | per server aan te passen door beheerders | rechtermuisknop op de bot → Bijnaam wijzigen |
| **Avatar** | het plaatje in de ledenlijst | `BOT_AVATAR` in `.env` + `npm run configure-install` |

Standaard is `BOT_NAME` **Setup Bot**. `npm run configure-install` zet de gebruikersnaam en
meldt het als de applicatienaam ervan afwijkt.

Twee dingen om te weten voordat je hem draait:

- Discord weigert gebruikersnamen met **"discord"** of **"clyde"** erin — vandaar `Setup Bot`
  en niet `Discord Setup Bot`. De *applicatienaam* in het portal mag "Discord" wel bevatten.
  Wordt een naam geweigerd, dan zegt het script precies wat Discord terugstuurt en laat het
  de rest van de instellingen ongemoeid.
- Een bot mag zijn gebruikersnaam **twee keer per uur** wijzigen. Daarna volgt een 429 tot
  het uur om is.

Voor de applicatienaam bestaat geen API; dat blijft handwerk in het portal.

De avatar staat standaard op `assets/logo.png` en gaat in dezelfde stap mee — als botavatar
en als applicatie-icoon. Een ongewijzigde afbeelding wordt overgeslagen: de hash ligt naast
het bestand, zodat je de rate limit op accountwijzigingen niet voor niets opbrandt.

Zet `DISCORD_DEV_GUILD_ID` in `.env` tijdens het ontwikkelen: commands zijn dan direct
actief in die ene server, in plaats van de globale registratie die tot een uur kan duren.

## Dashboard

```bash
npm run dashboard   # http://127.0.0.1:4000
```

### Eerst uitproberen zonder bot

```bash
npm install
npm run demo      # http://127.0.0.1:4000
```

Dit start het echte dashboard met een nagemaakte Discord-client ervoor: twee verzonnen servers,
geen token, geen applicatie in het Developer Portal. Je kunt templates bewerken, controleren,
vergelijken en een preview draaien; **Toepassen** weigert netjes, want er is niets om op toe te
passen. Je bewerkingen gaan naar `.demo/`, dus je echte `templates/` blijft ongemoeid.

Wil je alleen kijken zonder Node? `npm run build:demo` bouwt een statische versie in `docs/`
die GitHub Pages rechtstreeks kan serveren (Settings → Pages → main /docs).

De werkplek: links je templates, in het midden de gekozen template, rechts de servers waar
je hem op loslaat. Bedoeld om een server **helemaal in te richten voordat je uitrolt**.

### Structuur — klikken in plaats van JSON

- **Rollen**: naam, kleur, apart tonen, pingbaar, en alle rechten als vinkjes per groep.
  De volgorde in de lijst is de rolhierarchie — bovenaan staat de hoogste rol.
- **Kanalen en categorieen**: toevoegen, verwijderen, verplaatsen, hernoemen, type wisselen,
  onderwerp, slowmode, ledenlimiet, NSFW, forum-tags, en de berichten die bij het aanmaken
  in het kanaal gezet worden.
- **Rechten-matrix** per categorie en kanaal: rollen in de kolommen, permissies in de rijen.
  Klik een cel door toestaan (✓), niet ingesteld (·) en weigeren (✗). Bij een kanaal staat
  erbij of het de rechten van zijn categorie erft of niet.

Een rol hernoemen werkt alle verwijzingen bij (overwrites, automod, emoji's, onboarding);
een rol verwijderen haalt ze weg. De template blijft dus geldig terwijl je schuift.

Bewerkingen zijn terug te draaien met **Ctrl+Z** (of de pijl in de kop), opnieuw met
**Ctrl+Shift+Z**. In de JSON-tab houdt de browser zijn eigen tekst-undo.

### Server — wat er nu echt staat

Legt de template naast een aangevinkte server en kleurt elk onderdeel:

| Label | Betekenis |
| --- | --- |
| **nieuw** | staat in de template, nog niet op de server |
| **staat er al** | beide |
| **alleen op server** | staat op de server, niet in de template — drift |
| **ander type** | naam bestaat, maar bijvoorbeeld text waar de template voice wil |

Dat laatste kwadrant is waar het om gaat: je ziet wat er in de loop van de tijd op een
server is bijgekomen zonder dat je template het weet. Rollen van bots en integraties blijven
buiten beeld, want die beheert Discord zelf.

Mist er iets, dan staat er een knop **Herstel wat mist**. Die maakt alleen aan wat ontbreekt:
bestaande kanalen en rollen blijven zoals ze zijn en er wordt niets verwijderd. Voor het
volledige gelijktrekken gebruik je *Toepassen* met bijwerken aan.

**Blokken** (knop *Blok*) voegen een kant-en-klare brok toe: een welkomstzone, stafzone,
supportzone of spraakzone, met de rollen en rechten die erbij horen. Een rol die er al is
blijft staan. Zo bouw je een template uit losse stukken zonder een tweede bestandsformaat.
Een categorie dupliceren kan met de kopieerknop op de categorie zelf.

Bij elke permissie staat in gewone woorden wat hij doet — in de rechten-matrix onder de naam,
en als tooltip bij de vinkjes van een rol.

### JSON — de vluchtweg

Dezelfde template als tekst, altijd in sync met de editor. Opslaan gaat door dezelfde
validatie als de bot: een onbekende permissie of een verwijzing naar een niet-bestaande rol
wordt geweigerd en het bestand op schijf blijft ongemoeid.

**Versies schrijven zichzelf.** Elke opslag bewaart de vorige inhoud in `history/`, en de
lijst zegt per regel wat die opslag veranderde — "1 rol erbij", "2 kanalen weg". Je hoeft bij
het opslaan dus niets in te typen. Per versie kun je terugzetten of hem als JSON downloaden.

**Import en export**: *Download* geeft je de huidige template als bestand, *Import* leest er
een in als nieuwe template. Zo deel je een inrichting met iemand anders: stuur het bestand.

### Controle — voordat er iets echt gebeurt

- **Wat ziet @everyone / Lid / Moderator?** Per kanaal zichtbaar of niet, met de reden.
  Het model volgt Discord: een kanaal met eigen overwrites erft niets meer van zijn
  categorie — precies de val waar echte servers in trappen.
- **Controles** op Discord-limieten (kanalen, rollen, emoji's, forum-tags, automod per
  triggertype), dubbele namen, kanalen die niemand kan zien, riskante rechten voor
  @everyone, onboarding-eisen, en kanalen die ongemerkt de beperkingen van hun categorie
  kwijtraken.

De controle werkt op wat er op dat moment in de editor staat, dus ook op nog niet
opgeslagen wijzigingen.

### Uitrollen

- Vink een of **meerdere servers** aan. Elke server krijgt zijn eigen plan, back-up en
  resultaat; een server die rechten mist laat de rest van de rij gewoon doorlopen.
- **Preview** toont per server regel voor regel wat er zou gebeuren. **Toepassen** voert het
  uit na bevestiging.
- Voor elk toepassen gaat de structuur van de server naar `backups/`. Terugzetten kan met
  een knop — dat vult aan en werkt bij, maar **verwijdert nooit**: wat weg is, krijgt een
  back-up niet terug.
- **Server opslaan als template** leest een bestaande server uit naar een nieuwe template.

Servers met een probleem vallen meteen op: ontbrekende rechten en rollen die boven de bot
staan worden bij de serverkeuze getoond, niet pas als het toepassen halverwege vastloopt.

Het dashboard luistert **alleen op 127.0.0.1** en gebruikt dezelfde ingelogde client als de
bot: het praat namens je bot met Discord, dus het hoort niet naar buiten open te staan. De
token blijft aan de serverkant — de browser krijgt hem nooit te zien. Poort aanpassen kan
met `DASHBOARD_PORT`, mappen met `BACKUPS_DIR` en `HISTORY_DIR`.

### Inloggen met Discord

Zonder inloggen geldt: wie de pagina kan openen, kan namens je bot je servers herinrichten.
Daarom staat het dashboard standaard alleen op `127.0.0.1`. Met Discord-login weet de server
wie er kijkt, en kan hij veilig verder open.

```env
DISCORD_CLIENT_SECRET=...              # Developer Portal -> OAuth2 -> Client Secret
DASHBOARD_URL=http://127.0.0.1:4000    # de URL waarop jij het dashboard opent
DASHBOARD_OWNERS=                      # leeg = alleen de eigenaar van de applicatie
```

Zet in het Developer Portal onder **OAuth2 → Redirects** exact `<DASHBOARD_URL>/auth/callback`.
Wijkt die ene letter af, dan weigert Discord de inlog — dat is de meestgemaakte fout.

Wat het oplevert:

- **Een slot.** Zonder sessie geeft elke API-route 401. De sessie-id is 32 willekeurige bytes
  in een HttpOnly-cookie; JavaScript kan er niet bij en bij een herstart is hij weg.
- **Wie mag binnen.** Standaard alleen de eigenaar van de applicatie (of het team erachter).
  Iemand anders toelaten? Zijn gebruikers-id in `DASHBOARD_OWNERS`. Een geweigerde poging
  toont het id, zodat je het kunt kopiëren.
- **Jouw servers.** De `guilds`-scope laat zien waar jij beheerder bent — inclusief servers
  waar de bot nog niet in zit, met een knop **Toevoegen** die die server al voorselecteert.
  Dat is de snelste manier om de bot ergens binnen te krijgen.

Wat het **niet** doet: de bot wordt er niet machtiger van, en de bot-token stond al
server-side. Inloggen bepaalt alleen wie aan de knoppen mag.

Gevraagde scopes zijn `identify` en `guilds` — geen e-mail, geen toegang tot berichten.

### Op de telefoon

De pagina is gebouwd voor smalle schermen: de kolommen stapelen en de rechten-matrix scrollt
binnen zijn eigen kader.

Om er vanaf je telefoon bij te kunnen moet het dashboard van localhost af, en dat mag alleen
met inloggen aan — zonder client secret weigert hij te starten op een ander adres:

```env
DASHBOARD_HOST=0.0.0.0
DASHBOARD_URL=http://192.168.1.20:4000   # het adres van deze computer in je netwerk
```

Let op: binnen je eigen netwerk gaat dit over gewoon HTTP, dus het sessiecookie reist
onversleuteld. Voor thuis is dat een redelijke afweging; over het internet niet. Wil je er
van buiten bij, zet er dan een tunnel voor die HTTPS afhandelt (bijvoorbeeld `cloudflared`)
en zet `DASHBOARD_URL` op die https-URL — die moet dan ook in het portal staan.

## Templates

Templates zijn JSON-bestanden in `templates/`. De bestandsnaam (zonder `.json`) is wat je
in het commando kiest. Meegeleverd: `community`, `gaming` en `bedrijf`.

```json
{
  "name": "Mijn server",
  "description": "Korte omschrijving",
  "guild": {
    "verificationLevel": "medium",
    "systemChannel": "welkom",
    "afkTimeoutSeconds": 900
  },
  "roles": [
    {
      "key": "lid",
      "name": "Lid",
      "color": "#57f287",
      "hoist": true,
      "mentionable": false,
      "permissions": ["ViewChannel", "SendMessages", "ReadMessageHistory"]
    }
  ],
  "categories": [
    {
      "name": "Gesprekken",
      "overwrites": [
        { "role": "@everyone", "deny": ["ViewChannel"] },
        { "role": "lid", "allow": ["ViewChannel"] }
      ],
      "channels": [
        { "name": "algemeen", "type": "text", "topic": "Praat hier over alles" },
        { "name": "Lounge", "type": "voice", "userLimit": 8 }
      ]
    }
  ],
  "uncategorizedChannels": []
}
```

**Velden in het kort**

- `roles[].key` — interne sleutel waarnaar `overwrites` verwijzen. `@everyone` mag altijd
  gebruikt worden zonder dat je hem definieert. De volgorde van `roles` is de hierarchie.
- `permissions` / `allow` / `deny` — namen uit Discord's permissieset, bijvoorbeeld
  `ViewChannel`, `SendMessages`, `ManageMessages`, `Connect`, `Speak`, `Administrator`.
  Een onbekende naam laat de template bij het laden falen, niet halverwege het uitvoeren.
- `channels[].type` — `text`, `voice`, `forum`, `announcement` of `stage`.
- **Emoji in namen** mag gewoon; wat je hier neerzet komt er zo in te staan. De meegeleverde
  templates volgen de opmaak die je op veel servers ziet:
  categorie `📋 Algemeen` (emoji, spatie, naam) en kanaal `🗣️│algemeen` (emoji, een
  `│` — dat is U+2502, niet de gewone `|` — en dan de naam). Discord maakt van tekstkanalen
  zelf kleine letters met streepjes; de emoji en het streepje blijven staan. Voicekanalen
  mogen hoofdletters en spaties houden: `🔊│Staf Voice`.
- `slowmodeSeconds` (0–21600), `userLimit` (0–99, voice/stage), `nsfw`, `topic`.
- `channels[].messages` — berichten die bij het **aanmaken** in het kanaal gezet worden,
  standaard vastgepind. Opnieuw toepassen post niets dubbel. Alleen text en announcement.
- `channels[].tags` / `defaultReaction` / `autoArchiveMinutes` — forumkanalen.
- `guild` — `verificationLevel`, `explicitContentFilter`, `defaultMessageNotifications`,
  `systemChannel`, `afkChannel`, `rulesChannel`, `updatesChannel`, `afkTimeoutSeconds`,
  `description`, `icon`, `banner` (pad of https-URL) en `community`.
- `emojis` — `{ name, image, roles }`, met een pad of URL als bron.
- `automod` — regels met trigger `keyword`, `keyword_preset`, `spam` of `mention_spam`,
  actie `block`, `alert` of `timeout`, en uitzonderingen per rol.
- `onboarding` — vragen met keuzes, en de rollen en kanalen die daaraan hangen.

Wat een template beschrijft, richt de server dus compleet in: van rollen en kanalen tot
regels-bericht, AutoMod, onboarding en de volgorde waarin alles staat.

De snelste manier aan een eigen template te komen: richt een server met de hand in en
draai `/setup export`.

## Hoe het werkt

```
templates/*.json ──► zod-validatie ──► planner ──► plan ──► applier ──► Discord API
                                          ▲
                        snapshot van de huidige server
```

De planner vergelijkt een platte momentopname van de server met de template en levert een
lijst acties op. `preview` toont die lijst; `apply` voert hem sequentieel uit — rollen eerst,
dan categorieen, dan kanalen, zodat permissie-overwrites altijd naar bestaande rollen
verwijzen. Elke actie wordt los afgehandeld: een mislukte actie stopt de rest niet, maar
komt terug in het eindrapport.

Omdat de planner op gewone objecten werkt (`GuildSnapshot`) is de hele planlogica te testen
zonder gateway-verbinding. De simulator werkt op dezelfde manier: die rekent puur op de
template, zodat je zichtbaarheid kunt controleren zonder ook maar iets aan te raken.

## Projectstructuur

```
src/
  index.ts              bot-client en interaction-routing
  deploy-commands.ts    slash commands registreren
  configure-install.ts  install-settings (rechten bij elke join) en botnaam zetten
  invite.ts             invite-link printen
  botPermissions.ts     de enige lijst met rechten die de bot vraagt
  commands/setup.ts     /setup met list, preview, apply, export
  events/guildCreate.ts zelfcontrole en welkomstbericht bij het joinen
  dashboard.ts          start de bot met het lokale dashboard ernaast
  dashboard/server.ts   API voor templates, plannen, controleren en toepassen
  dashboard/index.html  de dashboardpagina (geen buildstap, geen dependencies)
  dashboard/app.js      dashboardlogica in de browser
  dashboard/editor.js   de klik-editor voor rollen, kanalen en permissies
  dashboard/ui.js       iconen, meldingen, dialogen en het thema
assets/logo.png         avatar en applicatie-icoon
  types.ts              zod-schema en validatie van templates
  templates.ts          templates inlezen uit de map
  snapshot.ts           bestaande server -> platte structuur
  planner.ts            snapshot + template -> plan
  applier.ts            plan uitvoeren via de Discord API
  exporter.ts           bestaande server -> template
  auth.ts               inloggen met Discord: sessies, cookies en toegang
  compare.ts            template naast de echte server: nieuw, gelijk of drift
  simulate.ts           wat ziet een rol straks? (zonder uit te rollen)
  lint.ts               controles op limieten, zichtbaarheid en rechten
  backup.ts             momentopname van een server voor het toepassen
  history.ts            vorige versies van templates
  permissions.ts        permissienamen <-> bitfields
  permissionCatalogue.ts  gegroepeerde permissielijst voor het dashboard
templates/              meegeleverde templates
tests/                  vitest-tests: schema, planner, simulatie, vergelijking, inloggen, dashboard-API
```

## Ontwikkelen

```bash
npm run typecheck
npm test
npm run build
```

## Waar draait dit?

De bot houdt een verbinding met Discord open en het dashboard bewaart je token en schrijft je
templatebestanden. Dat is een draaiend Node-proces, geen statische site — **GitHub Pages kan
het dus niet hosten**; die serveert alleen bestanden. Wat Pages wél kan is de demo uit `docs/`.

Voor het echte werk zijn er drie routes:

| Waar | Wanneer |
| --- | --- |
| **Je eigen computer** | Tijdens het inrichten. Simpel, maar de bot is offline zodra je afsluit. |
| **Altijd-aan machine** (Raspberry Pi, NAS, VPS) | Je hebt er al een. `npm run build && npm start`, en het dashboard erbij met `npm run dashboard`. |
| **Node-host** (Railway, Render, Fly.io, …) | Geen eigen machine. Zet de variabelen uit `.env.example` in hun instellingen. |

Let op: zodra het dashboard van localhost af gaat, is inloggen verplicht — zie
[Inloggen met Discord](#inloggen-met-discord). En de map `templates/` moet blijven bestaan
tussen herstarts, anders ben je je templates kwijt bij elke deploy.

### Zonder computer: via GitHub Actions

Geen machine bij de hand? `.github/workflows/server-inrichten.yml` draait de bot op een
GitHub-runner — dat is een computer met internet die je vanaf je telefoon start.

Eenmalig, onder **Settings → Secrets and variables → Actions**: `DISCORD_TOKEN` en
`DISCORD_CLIENT_ID`. Die staan daar versleuteld; ze horen niet in een chat of in de code.

Daarna: **Actions → Server inrichten → Run workflow**, server-id invullen, template kiezen.
Laat `mode` op `preview` om alleen te zien wat er zou gebeuren; zet hem op `apply` om het echt
uit te voeren. De log toont regel voor regel wat er gebeurde.

Handig voor een eerste test, en voor een server inrichten terwijl je onderweg bent. Het is
geen vervanging van het dashboard: bewerken doe je daar, uitvoeren kan hier.

Hetzelfde commando werkt ook gewoon in een terminal:

```bash
npm run apply -- --guild 123456789 --template community          # alleen tonen
npm run apply -- --guild 123456789 --template community --apply  # uitvoeren
```

**Alleen een deel toepassen.** Een template hoeft niet in zijn geheel. Wil je alleen de
rollen bijwerken en de kanalen met rust laten:

```bash
npm run apply -- --guild 123456789 --template community --apply --alleen rollen
```

| Onderdeel | Wat eronder valt |
| --- | --- |
| `rollen` | rollen aanmaken, bijwerken en op volgorde zetten |
| `categorieen` | categorieen aanmaken en bijwerken, met hun rechten |
| `kanalen` | kanalen aanmaken, bijwerken, verwijderen en op volgorde zetten, met hun rechten en berichten |
| `automod` | de AutoMod-regels |
| `emojis` | de emoji uit de template |
| `instellingen` | serverinstellingen, het systeem- en regelskanaal, en community-modus |
| `onboarding` | de vragen die nieuwe leden krijgen |

Meerdere tegelijk mag: `--alleen kanalen,categorieen`. Het plan wordt altijd volledig
berekend en daarna gefilterd, zodat de volgorde klopt — community-modus gaat nog steeds
vóór de kanalen die hem nodig hebben. Kies je kanalen zonder categorieen, dan slaat hij de
kanalen over die in een nog niet bestaande categorie horen en zegt hij dat, in plaats van ze
los op de server te zetten.

In de Action is het het veld **onderdelen** (standaard `alles`), in het dashboard een rijtje
vinkjes onder *Welke onderdelen* op het uitrolscherm. Ook de rechtencontrole kijkt mee naar
je keuze: werk je alleen de rollen bij, dan houdt een template met community-modus je niet
tegen.

### Een testserver weer leeghalen

Bouwen, kijken, leeghalen, opnieuw — dat is de ronde waarmee je een template aanscherpt.
`prune` haalt alleen kanalen weg; dit haalt de hele inrichting eruit.

```bash
npm run reset -- --guild 123456789                         # alleen tonen
npm run reset -- --guild 123456789 --bevestig "Testserver" # echt leeghalen
```

De bevestiging moet exact de naam van die server zijn, anders gebeurt er niets. Vanaf je
telefoon kan het ook: **Actions → Leeghalen**, met dezelfde bevestiging. Dat is een
aparte workflow, zodat je hem niet per ongeluk aantikt naast "inrichten".

**Zelf kiezen wat er weg mag.** Standaard gaat alles weg. Wil je bijvoorbeeld de kanalen
opnieuw doen maar de rollen houden — dan hoef je niemand opnieuw een rol te geven — dan zet
je dat ene deel uit:

```bash
npm run reset -- --guild 123456789 --bevestig "Testserver" --behoud-rollen
```

| Vlag | Wat er blijft staan |
| --- | --- |
| `--behoud-rollen` | alle rollen |
| `--behoud-kanalen` | alle kanalen en categorieen |
| `--behoud-automod` | de AutoMod-regels |

In de Action staan het als drie vinkjes: **Ook de rollen verwijderen**, **Ook de kanalen
verwijderen**, **Ook de AutoMod-regels verwijderen**. Ze staan alle drie aan; haal er een
weg en dat deel blijft staan. Zet je ze alle drie uit, dan stopt hij met een melding in
plaats van een run die niets doet. Wat er deze keer weg gaat en wat blijft, staat boven aan
het log.

| Gaat weg | Blijft staan |
| --- | --- |
| alle kanalen en categorieen | @everyone |
| rollen die de bot mag beheren | rollen van bots en integraties |
| AutoMod-regels | rollen die even hoog of hoger staan dan de bot |
| | leden, emoji's, de servernaam |

### Als een Action blijft hangen

Het komt voor dat GitHub een run in **Queued** laat staan zonder hem te starten, en dat
annuleren dan ook niet lukt ("Something went wrong while executing your query"). Zo'n run
heeft nog geen job gedraaid, dus er is niets gebeurd op je server.

Twee dingen om te weten:

- **Blijf niet op "Re-run" drukken.** Elke poging zet de run opnieuw in dat halve
  wachtstand-hoekje; daarna weigert ook de API te annuleren (`409 Cannot cancel a workflow
  re-run that has not yet queued`). Een nieuwe run starten kan gewoon — een vastgelopen run
  blokkeert niets.
- **Een oude opdracht gaat niet alsnog af.** Beide workflows kijken als eerste stap hoe lang
  de opdracht al in de wachtrij staat. Langer dan 30 minuten en hij stopt met een melding,
  vóór de checkout. Voor het leeghalen geldt dat altijd, voor het inrichten bij *apply* (een
  preview verandert toch niets).

Hangt er nog een run van vóór die controle, dan draait die de oude versie van de workflow,
zonder die eerste stap. Wil je zeker weten dat hij niets doet: **hernoem je testserver even**
in Discord. Het leeghalen eist dat de bevestiging exact de servernaam is, dus dan stopt hij
op de bevestiging en verwijdert hij niets. Daarna hernoem je hem terug.

Blokkeert zo'n run de knop om een nieuwe te starten, dan is de uitweg een **andere
bestandsnaam**: een workflow hoort bij zijn bestand, dus `leeghalen.yml` is voor GitHub een
nieuwe workflow met een lege lijst en een knop die het wel doet. Daarom heet deze niet meer
`server-leeghalen.yml`. De oude run blijft in de geschiedenis staan tot GitHub hem opruimt.

Vooraf gaat er een momentopname naar `backups/` (de GitHub Action hangt hem aan de run als
download). Die brengt de structuur terug, geen berichten: een verwijderd kanaal komt terug
als leeg kanaal. Doe dit dus op een testserver, niet op een server met mensen erin.

### Naast andere diensten op een VPS

In `deploy/` staan een systemd-unit en een nginx-serverblok. De aanpak:

```bash
sudo useradd --system --home /opt/setup-bot setupbot
sudo git clone https://github.com/picknicken/discord-bot /opt/setup-bot
cd /opt/setup-bot && sudo -u setupbot npm ci && sudo -u setupbot npm run build
sudo -u setupbot cp .env.example .env   # en invullen

sudo cp deploy/setup-bot.service /etc/systemd/system/
sudo systemctl enable --now setup-bot
```

Vier dingen om te controleren voordat je begint:

- **Node 20 of hoger** op de machine. Een Python-stack heeft dat niet automatisch.
- **Een vrije poort op localhost.** Het dashboard luistert standaard op `127.0.0.1:4000`;
  draait daar al iets, zet `DASHBOARD_PORT` op iets anders.
- **Een eigen Discord-applicatie.** Deze bot hoort een eigen token te hebben, niet die van
  een bot die er al draait.
- **Schrijfrechten** op `/opt/setup-bot` voor `templates/`, `backups/` en `history/`. De
  unit staat verder alles op alleen-lezen.

Met nginx ervoor draait het dashboard over https, en dan reist het sessiecookie versleuteld.
Zet `DASHBOARD_URL` op die https-URL en registreer `<DASHBOARD_URL>/auth/callback` in het
Developer Portal.

## Bekende grenzen

- **Terugzetten is geen tijdmachine.** Een back-up bevat de structuur, niet de berichten.
  Een verwijderd kanaal komt terug als leeg kanaal; wat erin stond is weg. Daarom verwijdert
  terugzetten ook nooit iets.
- **Berichten worden alleen bij het aanmaken geplaatst.** Dat houdt opnieuw toepassen veilig,
  maar betekent ook dat een gewijzigde regelstekst niet vanzelf in een bestaand kanaal komt.
- **AutoMod-regels worden niet geexporteerd** bij `export`: die staan niet in de cache en
  zouden een losse API-call vergen. Rollen, kanalen, rechten en emoji's wel.
- **Stickers** vallen buiten deze versie.
- Een **banner** werkt pas vanaf boostniveau 2; zonder boosts negeert Discord het veld.
- De **rolvolgorde** wordt onder de rol van de bot gezet. Staat die te laag, dan wordt de
  volgorde overgeslagen met een melding in plaats van half uitgevoerd.
- Bij grote templates kan Discord's rate limiting het uitvoeren vertragen — dat is normaal,
  discord.js wacht automatisch.
