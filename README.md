# Discord Setup Bot

Een Discord-bot die complete servers inricht vanuit JSON-templates: rollen, categorieen,
kanalen, permissie-overwrites en serverinstellingen — in een keer, reproduceerbaar.

## Wat de bot doet

| Commando | Wat het doet |
| --- | --- |
| `/setup list` | Toont alle beschikbare templates met aantallen rollen/kanalen |
| `/setup preview template:<naam>` | Laat het volledige plan zien **zonder iets te wijzigen** |
| `/setup apply template:<naam> bevestig:<servernaam>` | Voert het plan uit |
| `/setup export` | Slaat de huidige server op als template in de templates-map (en stuurt het JSON-bestand mee) |

Daarnaast is er een tweede tak, voor OSRS-clans (via WiseOldMan):

| Commando | Wat het doet |
| --- | --- |
| `/clan koppel rsn:<naam>` | Koppelt je OSRS-naam en geeft je de rol die bij je clanrang hoort |
| `/clan mij` | Werkt je eigen clanrol nu bij |
| `/clan ontkoppel` | Haalt je naam en je clanrollen weer weg |
| `/clan status` | Welke clans hier meetellen, en wat er over jou bekend is |
| `/clan wie lid:<@lid>` | Beheer: welke OSRS-naam hoort bij dit lid |
| `/clan sync` | Beheer: werkt de clanrollen van iedereen bij |
| `/clan knop` | Beheer: zet een knop neer waarmee leden hun naam koppelen |

Hetzelfde kan lokaal via het dashboard (`npm run dashboard`), inclusief het bewerken van
templates en het instellen van de clanrangen.

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

### Slash-commando's

`/setup` en `/clan` bestaan pas in Discord als ze daar aangemeld zijn. **Dat doet de bot zelf,
bij elke keer dat hij opstart** — en alleen als er iets veranderd is, want Discord staat maar
tweehonderd wijzigingen per dag toe. Je hoeft er dus niets voor te doen: rolt er een nieuwe
versie uit met een commando erbij, dan staat het er na de herstart.

Wat je daarbij moet weten:

- **In een nieuwe server** verschijnen ze vanzelf, maar Discord kan er tot een uur over doen.
  Zie je ze daarna nog steeds niet, dan is de bot waarschijnlijk toegevoegd **zonder de scope
  `applications.commands`** — dan mag hij wel praten, maar horen zijn commando's er niet bij.
  Opnieuw toevoegen met de link uit het dashboard (*Instellingen → Uitnodigen*) of
  `npm run invite` zet dat recht zonder hem eruit te gooien.
- **In het dashboard** staat onder *Instellingen* welke commando's Discord nu kent, en of die
  nog kloppen met deze versie. Er staat een knop naast om ze meteen opnieuw aan te melden,
  voor als het een keer is misgegaan.
- **Meteen zichtbaar** in één server kan met **Actions → Commands registreren**, keuze *alleen
  in deze server*. Dat maakt kopieën náást de globale commando's; die haal je later weg met de
  keuze *uit deze server weghalen*. Op een computer: `npm run deploy`, met
  `DISCORD_DEV_GUILD_ID` erbij voor één server en `COMMANDS_MODUS=weghalen` om op te ruimen.
- Wil je dit zelf in de hand houden, zet dan `COMMANDS_AANMELDEN=uit`; dan meldt de bot niets
  meer uit zichzelf aan.

### Nederlands of Engels

De bot praat met leden, en die spreken lang niet allemaal Nederlands. Hij kijkt daarom in welke
taal Discord staat en antwoordt daarin — Nederlands of Engels, er is niets in te stellen.

- **Bij een klik of een commando** telt de taal van die persoon zelf. Jij krijgt Nederlands, je
  Engelse clangenoot krijgt Engels, in dezelfde server en op hetzelfde moment.
- **Bij een bericht dat in een kanaal blijft staan** — het welkomstbericht, de koppelknop, een
  rolmenu, het bericht bij binnenkomst van de bot — telt de taal van de **server**. Dat leest
  iedereen mee, dus daar hoort één taal te staan.
- **Alles wat geen Nederlands is, krijgt Engels.** Wie Duits of Frans in Discord heeft staan
  begrijpt het Engels wel, en het Nederlands vrijwel zeker niet.

De commando's zelf zijn ook vertaald: wie Discord in het Engels heeft staan typt `/clan link`,
`/clan me`, `/clan unlink`, `/clan who` en `/clan button` — hetzelfde commando, andere naam. Dat
hoef je nergens aan te melden; de bot doet dat zelf bij het opstarten.

Wat (nog) Nederlands blijft: het dashboard, en wat `/setup` terugmeldt over een plan
("+ rol @Lid"). Dat is beheerderswerk; de teksten die een gewoon lid tegenkomt zijn vertaald.

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

**Hij vraagt er zelf om.** De invite-link vraagt Administrator, en `npm run invite` toont hem;
de Action **Bot instellen** zet daarnaast de *default install settings* van de applicatie, zodat
elke Add App-knop er voortaan vanzelf om vraagt. Komt de bot toch zonder Administrator binnen,
dan zegt hij dat meteen in een bericht op de server — met wat er dan blijft liggen en een link
om het in een klik te regelen. In het dashboard staat het als een badge bij de server.

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

### Discord-donker

Het dashboard staat standaard donker, in de kleuren van Discord zelf: blurple voor knoppen,
`#313338` voor het midden, `#2b2d31` voor de panelen. Je bouwt hier een Discord-server en ziet
hem daarna in Discord terug — dan hoort dit scherm daar niet los van te staan. Licht blijft
bestaan: één klik op de knop rechtsboven, en die keuze onthoudt hij.

### Structuur — klikken in plaats van JSON

- **Serverinstellingen** (bovenaan de lijst): verificatieniveau, het scannen op aanstootgevende
  media, standaardmeldingen, welk kanaal het systeem-, AFK-, regels- en updateskanaal is, en
  community-modus. Die stonden eerst alleen in de JSON, terwijl het het eerste is wat je invult.
  Leeg laten betekent: laat staan wat er op de server staat.
- **Rollen**: naam, kleur, apart tonen, pingbaar, en alle rechten als vinkjes per groep.
  De volgorde in de lijst is de rolhierarchie — bovenaan staat de hoogste rol.
- **Kanalen en categorieen**: toevoegen, verwijderen, verplaatsen, hernoemen, type wisselen,
  onderwerp, slowmode, ledenlimiet, NSFW en forum-tags.
- **Rechten-matrix** per categorie en kanaal: rollen in de kolommen, permissies in de rijen.
  Klik een cel door toestaan (✓), niet ingesteld (·) en weigeren (✗). Bij een kanaal staat
  erbij of het de rechten van zijn categorie erft of niet.

Een rol hernoemen werkt alle verwijzingen bij (overwrites, automod, emoji's, onboarding);
een rol verwijderen haalt ze weg. De template blijft dus geldig terwijl je schuift.

Bewerkingen zijn terug te draaien met **Ctrl+Z** (of de pijl in de kop), opnieuw met
**Ctrl+Shift+Z**. In de JSON-tab houdt de browser zijn eigen tekst-undo.

### Voorbeeld — hoe het er straks uitziet

Naast de structuur staat een nagebouwde kanalenlijst: de server zoals Discord hem straks toont.
Niet omdat het er leuk uitziet, maar omdat een template op papier niets zegt over wat een lid
ziet. Eén overwrite verkeerd en het halve serverbeeld klopt niet.

Bovenin kies je **wiens ogen**: `@everyone`, of een van je eigen rollen. Kanalen die die rol
niet mag zien worden doorgestreept met een oog-icoon, en eronder staat hoeveel er overblijft —
*"8 van de 15 kanalen zichtbaar"*. Wijs een doorgestreept kanaal aan en je ziet waaróm.

Het rekent mee terwijl je typt, en gebruikt dezelfde simulatie als het controlescherm; niet een
tweede keer nagebouwd in de browser, want dan lopen die twee vroeg of laat uit elkaar. Op een
breed scherm staat het ernaast, daaronder eronder.

### Uitrollen — eerst de diff

Voor je op **Toepassen** drukt, laat **Preview** zien wat er precies gaat gebeuren, als een diff
in plaats van een lap tekst:

```
+ 🛡 @Moderator
+ 📁 👋 Welkom
+ # 👋│welkom        in 👋 Welkom
~ # 💬│algemeen      topic, slowmode
~ ⇅ 20 kanalen en categorieen

3 worden verwijderd — dit kun je niet terugdraaien
- # oude-memes                              verdwijnt
```

Groen is nieuw, grijs is bijwerken met erachter wát er verandert, en rood staat onderaan in een
eigen blok: dat is het enige dat je niet terugkrijgt, en het gebeurt alleen als je *"kanalen
verwijderen die niet in de template staan"* hebt aangevinkt.

### Back-ups — ophalen en terugzetten

Voor elk toepassen en elk leeghalen gaat de structuur van de server naar `backups/`. In het
**Back-ups**-scherm staat per momentopname een knop om hem **terug te zetten** en een om hem te
**downloaden**.

Dat downloaden is geen bijzaak: draait de bot bij een hostingpartij zonder volume, dan staat die
map op een schijf die bij de volgende deploy leeg is. Een back-up die je niet kunt ophalen, is
geen back-up. Haal hem dus op en bewaar hem ergens.

Andersom kan ook: **Back-up uit bestand terugzetten** leest een gedownload bestand weer in, vraagt
op welke server het moet, en vult die server aan. Zo kun je ook de structuur van de ene server op
de andere zetten. Terugzetten verwijdert nooit iets, dus wat er extra staat blijft staan — dat
meldt hij er achteraf bij.

### Instellingen — waar deze bot op staat

Het laatste scherm in de zijbalk toont wat deze installatie ervan gemaakt heeft: op welk adres
hij luistert, of inloggen aanstaat, welke servers hij mag aanraken (`GUILD_IDS`), en in welke
mappen hij schrijft — met een waarschuwing als er geen volume hangt, want dan is dat na een
nieuwe deploy weg.

Daar staat ook de **redirect-URL** die hij naar Discord stuurt. Precies die tekst moet in het
Developer Portal staan; klopt hij niet, dan weigert Discord de inlog zonder te zeggen welk adres
hij dan wél kreeg. De token en het client secret staan er niet bij en komen ook nergens in de
pagina terecht.

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

### Rollen — rechtstreeks in de server

Voor een kleine wijziging hoef je geen template te bewerken en uit te rollen. Open een server
onder **Servers** en klik in het paneel **Rollen** op een rol: naam, kleur, apart tonen,
pingbaar en alle rechten zijn daar aan te passen. **Opslaan in Discord** stuurt alleen wat je
veranderd hebt, met jouw naam als reden in het auditlog. Een rol aanmaken en verwijderen kan
daar ook.

De bot zegt vooraf wat hij niet mag, in plaats van een foutmelding na het opslaan: rollen van
bots en integraties, rollen boven (of gelijk aan) zijn eigen rol, en rechten die hij zelf niet
heeft. Zo'n rol staat er met **vast** en de reden erbij.

Daarna wijkt de server af van zijn template, en de driftcontrole zegt dat ook. Wil je de
wijziging in de template hebben, gebruik dan **Overnemen**.

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
- **Alleen jouw servers.** Je ziet en kunt uitsluitend de servers waar jij zelf
  serverbeheerder bent. Dat de bot ergens in zit maakt die server nog niet van jou: staat hij
  in tien servers en ben jij in twee daarvan beheerder, dan zie je er twee. Dat geldt voor de
  hele lijst — servers, back-ups en de uitrolgeschiedenis — en voor elke knop: plannen,
  toepassen, vergelijken, exporteren en terugzetten geven **403** op een server die niet van
  jou is. Zit er in een rij servers één vreemde, dan gaat de hele opdracht niet door: stil
  overslaan zou je laten denken dat het gelukt is.

Wat het **niet** doet: de bot wordt er niet machtiger van, en de bot-token stond al
server-side. Inloggen bepaalt alleen wie aan de knoppen mag.

### Een lijst met toegestane servers

Het dashboard weet wie er ingelogd is. Een GitHub Action weet dat niet: daar is het server-id
een invoerveld, en iedereen die de knop mag indrukken kan er elk id in typen. `GUILD_IDS` is
de rem — een lijst server-ids, komma-gescheiden:

```env
GUILD_IDS=1547978044084330588,123456789012345678
```

Voor de Actions zet je dezelfde lijst onder **Settings → Secrets and variables → Actions →
Variables** als `GUILD_IDS` (een variabele, geen secret — het zijn geen geheimen). Staat er een
id ingetypt dat er niet op staat, dan stopt de run vóór het inloggen, met de reden en de lijst
in de gekleurde balk boven aan de run. Er is dan niets veranderd.

Leeg laten mag: dan is er geen beperking. Dat is de stand voor wie de bot alleen zelf gebruikt.
Het dashboard houdt zich aan dezelfde lijst, dus een server die er niet op staat verdwijnt ook
daar uit beeld, en `/setup` weigert hem in Discord zelf.

En in Discord: `/setup` staat standaard alleen open voor wie **Server beheren** heeft, maar dat
is een standaard die een serverbeheerder onder **Instellingen → Integraties** opzij kan zetten.
Daarom controleert het commando het recht zelf nog een keer, waar niemand het kan wegklikken.
Alleen `/setup list` mag iedereen — dat toont de templates en raakt de server niet aan.

Gevraagde scopes zijn `identify` en `guilds` — geen e-mail, geen toegang tot berichten.

### Op de telefoon

De pagina is gebouwd voor smalle schermen: de kolommen stapelen en de rechten-matrix scrollt
binnen zijn eigen kader. De zijbalk verdwijnt en er komt een balk onderaan met de vier
schermen die je het meest gebruikt — Overzicht, Templates, Servers en Uitrollen. De rest
(Clan, Geschiedenis, Back-ups, Instellingen en de licht/donker-knop) zit achter **Meer**,
dat oplicht zodra je op zo'n scherm bent.

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
- `channels[].tags` / `defaultReaction` / `autoArchiveMinutes` — forumkanalen.
- `guild` — `verificationLevel`, `explicitContentFilter`, `defaultMessageNotifications`,
  `systemChannel`, `afkChannel`, `rulesChannel`, `updatesChannel`, `afkTimeoutSeconds`,
  `description`, `icon`, `banner` (pad of https-URL) en `community`.
- `emojis` — `{ name, image, roles }`, met een pad of URL als bron.
- `automod` — regels met trigger `keyword`, `keyword_preset`, `spam` of `mention_spam`,
  actie `block`, `alert` of `timeout`, en uitzonderingen per rol.
- `onboarding` — vragen met keuzes, en de rollen en kanalen die daaraan hangen.

Wat een template beschrijft, richt de server dus compleet in: van rollen en kanalen tot
AutoMod, onboarding en de volgorde waarin alles staat.

**Wat een template níet doet: in je kanalen praten.** Een template beschrijft de vorm van je
server — kanalen, rollen, rechten — en zet er geen tekst in. Geen welkomstbericht, geen
regels-bericht, niets met de bot als afzender. Het kanaal `✅│regels` wordt gewoon aangemaakt;
wat erin komt te staan schrijf jij zelf. (Oudere templates met een `messages`-veld laden nog
prima: dat veld wordt genegeerd.)

De snelste manier aan een eigen template te komen: richt een server met de hand in en
draai `/setup export`.

### Kanalen waar de bot vanaf blijft

Niet alles in je server is van jou. Een ticketbot maakt kanalen aan die niemand van tevoren kan
opschrijven — `ticket-0042` bestaat vanmiddag en morgen niet meer. Zet je zo'n kanaal niet in je
template, dan is het bij een uitrol met `--prune` "niet in de template, dus weg", en dat zijn de
openstaande tickets van je leden.

```json
"negeer": ["Tickets", "ticket-*", "🎫│support"]
```

- De naam van een **categorie** dekt alles wat erin staat. Dat is meestal wat je wil: de kanalen
  van een ticketbot hebben geen vaste naam, maar staan wel altijd op dezelfde plek.
- Een `*` staat voor "wat dan ook": `ticket-*` vangt ze allemaal. De rest van de naam is gewone
  tekst, dus een kanaal dat `c++` heet geeft geen gedoe.
- Wat genegeerd wordt, wordt **niet bijgewerkt en niet verwijderd** — ook niet met prune aan, en
  het telt ook niet mee als afwijking. Aanmaken mag hij nog wel: de template blijft de baas over
  wat er hoort te zijn. Staat de categorie `Tickets` in je template, dan maakt hij die gewoon aan
  als hij ontbreekt, en blijft hij van de inhoud af.
- In de preview staat wat er is overgeslagen: *"2 dingen blijven met rust omdat de template ze
  negeert: stof, Archief."* Stille overslaan is hoe je later niet meer begrijpt waarom een kanaal
  niet bijgewerkt wordt.

In het dashboard staat dit onder **Serverinstellingen → Blijf hier vanaf**, als namen met komma's.

Let op: **leeghalen kent geen template, en dus ook geen negeer-lijst.** Dat commando haalt alles
weg wat de bot mag weghalen; daar is de getypte bevestiging de rem.

### Rolmenu's: knoppen waarmee leden zichzelf een rol geven

"Klik op 🎮 voor de gamer-rol" staat op half Discord, en daar had je tot nu toe een tweede bot
voor nodig. Het staat nu in de template: welk kanaal, welke tekst, welke rollen.

```json
"roleMenus": [
  {
    "channel": "🎭│rollen",
    "title": "Waar speel je op?",
    "description": "Klik op een knop. Nog een keer klikken haalt de rol er weer af.",
    "style": "buttons",
    "options": [
      { "role": "pc", "emoji": "🖥️" },
      { "role": "console", "label": "Console", "emoji": "🎮" }
    ]
  }
]
```

- `style` is `buttons` (tot 25 knoppen, vijf per rij) of `menu` (een keuzemenu; daar mag een
  `description` per keuze bij). In een keuzemenu vink je aan wat je wil en uit wat je niet meer
  wil; nul kiezen mag ook.
- `label` is wat er op de knop komt; laat je hem weg, dan is het de naam van de rol.
- De bot houdt het bericht bij. Staat het er al precies zo, dan gebeurt er niets. Is er iets
  veranderd, dan wordt hetzelfde bericht bijgewerkt - niet een tweede geplaatst. Hij herkent
  zijn eigen bericht aan de knoppen en aan de titel, dus twee menu's met dezelfde titel in
  hetzelfde kanaal kan niet.
- Wat er gebeurt als iemand klikt, ziet alleen hij: "Je hebt nu **PC**." Lukt het niet, dan
  zegt hij waarom - meestal omdat de rol boven de rol van de bot staat, en dat is in tien
  seconden op te lossen.
- De controle slaat alarm als een rol in een menu Administrator, ManageGuild of iets anders
  zwaars heeft: dat is geen rolmenu maar een deur die op een kier staat. Ook als niemand het
  kanaal kan zien hoor je dat te weten.
- In het dashboard staan de rolmenu's onder de kanalen in de structuurweergave: een menu
  toevoegen, er rollen bij kiezen, en per rol wat erop komt te staan.

Wat een export níet meeneemt zijn de rolmenu's: die staan in berichten en niet in de structuur
van een server.

### Voortbouwen op een andere template

Twee servers die op elkaar lijken hoef je niet twee keer te onderhouden. Met `basis` zegt een
template: neem alles van die andere, en hieronder staat alleen wat er anders is.

```json
{
  "basis": "community",
  "name": "Community met support",
  "roles": [
    { "key": "team", "color": "#ed4245" },
    { "key": "support", "name": "Support", "permissions": ["ViewChannel", "ManageMessages"] }
  ],
  "categories": [
    { "name": "📋 Algemeen", "channels": [{ "name": "💬│memes" }] }
  ],
  "verwijder": { "roles": ["vip"], "channels": ["🎲│spelletjes"] }
}
```

Wat hier gebeurt: `team` bestaat al in `community` en krijgt alleen een andere kleur - de rest
van die rol blijft zoals hij was. `support` bestaat nog niet en komt erbij. De categorie
`📋 Algemeen` bestaat al en krijgt er een kanaal bij; de kanalen die er al in zaten blijven
staan. En wat je niet wil, haal je met `verwijder` weg.

- Rollen worden bij elkaar gezocht op `key`, categorieën, kanalen, emoji's en automod-regels op
  `name`, en overwrites op `role`. Alleen wat je noemt verandert.
- Lijsten met waarden (`permissions`, `allow`, `deny`, `keywords`) worden vervangen en niet
  aangevuld: half overnemen levert een lijst op die niemand bedoeld heeft.
- De volgorde is die van de basis. Wat de basis nog niet kende komt erachteraan. Een andere
  volgorde dan de basis kun je hier dus niet afdwingen - dat hoort in de basis zelf.
- `verwijder` kan `roles`, `categories`, `channels`, `uncategorizedChannels`, `emojis` en
  `automod`. Een naam die de basis niet kent is een fout: dat betekent bijna altijd dat de
  basis veranderd is en deze template achterloopt.
- Een basis mag zelf ook weer een basis hebben. Een basis die (via via) naar zichzelf wijst
  wordt geweigerd, net als een basis die niet bestaat.

In het dashboard: **Kopiëren** vraagt nu of je een losse kopie wil of een variant die erop
voortbouwt. Bij een template met een basis staat er boven de structuur welke basis dat is, met
een knop om te zien wat het samen wordt. Een basis verwijderen kan niet zolang er iets op
voortbouwt, en het overnemen van een server schrijft weer alleen het verschil terug - past dat
niet (bijvoorbeeld door een andere volgorde), dan zegt hij dat in plaats van de basis stilletjes
uit het bestand te halen.

## Clanrangen (OSRS via WiseOldMan)

De tweede tak van deze bot. `/setup` bouwt de server; dit bepaalt wie er binnen welke rol
krijgt, op basis van de rang die iemand in de clan heeft.

Old School RuneScape heeft zelf geen clan-API. [WiseOldMan](https://wiseoldman.net) wel: daar
heet een clan een **group**, en die group heeft een ledenlijst met per speler zijn rang. Dat
is precies wat hier gebruikt wordt. Je clan moet er dus op staan en bijgehouden worden — dat
doet de clan zelf, met de WiseOldMan-plugin in RuneLite of op de site.

```
WiseOldMan (group "Dutch mayhem")      Discord
Sparc Mac — owner              ->   @Dutch mayhem
Tess      — captain            ->   @Dutch mayhem
Noa       — member             ->   @Dutch mayhem
Milan     — (staat er niet in) ->   (geen rol)
```

### Instellen

Daarna, in het dashboard → **Clan**. Per server:

1. **Clans die meetellen** — zoek je clan op naam en klik **Laat meetellen**. Alleen de clans
   die je hier kiest doen mee; iemand die in een andere clan zit telt niet. Je kunt er meer
   dan één kiezen (handig voor een Discord met een hoofdclan en een tweede clan).
2. **Eén rol voor de clan** — bijvoorbeeld `@Dutch mayhem`. Die krijgt iedereen die in de
   ledenlijst staat; wie er niet in staat krijgt niets. Dat is het hele onderscheid: zit in de
   clan, of zit er niet in. Staat de rol er nog niet, dan maakt **Aanmaken** hem in één tik,
   met de naam van de clan erop — bestaat er al een rol met die naam, dan pakt hij die.
4. **Verder nog** — een rol voor gekoppelde leden die in géén van de gekozen clans zitten, de
   bijnaam in Discord gelijktrekken met de OSRS-naam, en of de bot elk uur vanzelf bijwerkt.
5. **Rollen bijwerken** — eerst **Voorbeeld**: per lid één regel met wat hij krijgt en verliest.
   Pas daarna de knop die het echt doet.

Staat iemand in twee gekozen clans, dan krijgt hij van allebei de rollen. Dat is de enige
regel die zich zonder voorrangslijstje laat uitleggen: elke clan die je kiest telt op zichzelf.

### Wie is wie

Dit is het enige stukje dat niet vanzelf gaat, en dat kan ook niet: **Discord weet alleen
iemands Discord-naam.** Welk OSRS-account daarachter zit weet niemand — WiseOldMan niet, en de
bot dus ook niet. Elk lid moet één keer zeggen hoe hij in het spel heet. Daarna gaat alles
vanzelf.

Daarom staat er een knop klaar. Wie de server binnenkomt krijgt meteen een bericht:

```
👋 Welkom! Zit je in de clan?
   Zit je in Mijn Clan? Koppel dan je OSRS-naam, dan krijg je meteen
   de rol die bij je rang hoort.
   [ 🎣 Koppel je OSRS-naam ]
```

Eén tik, naam invullen in het venstertje, klaar — geen commando's typen, wat op een telefoon
een groot verschil is. Het antwoord ziet alleen hij:

```
Tess staat in Dutch mayhem als Captain.
Krijgt @Dutch mayhem.
```

Voor wie er al was: `/clan knop` zet dezelfde knop vast in het kanaal waar je hem uitvoert. Die
blijft werken, ook voor wie later komt. En `/clan koppel rsn:<naam>` bestaat gewoon nog.

**Staat iemand niet in een van de gekozen clans, dan krijgt hij geen rol** — maar zijn naam
blijft wel gekoppeld. Zo weet je alsnog wie wie is in het spel, en zodra hij lid wordt telt hij
bij de eerstvolgende ronde vanzelf mee. Wil je zulke mensen tóch een rol geven (bijvoorbeeld
`@Gast`), vul dan de gastrol in; laat je hem leeg, dan gebeurt er niets.

De bot vraagt WiseOldMan bovendien in welke clans zo iemand wél zit. Dat scheelt het verschil
tussen *"je naam staat verkeerd"* en *"je zit in een clan die hier niet meetelt"*.

#### Server Members Intent

Om binnenkomers te kúnnen begroeten moet de bot ze zien binnenkomen, en dat is bij Discord een
schakelaar: **Developer Portal → jouw applicatie → Bot → Privileged Gateway Intents → Server
Members Intent**. Staat hij uit, dan start de bot gewoon (hij vraagt er dan niet om — anders
zou Discord de hele inlog weigeren), maar blijft het welkomstbericht achterwege. Je ziet het
in het log en in het clanscherm, en `/clan knop` werkt ondertussen wel.

In het dashboard staan alle koppelingen bij elkaar: wie het deed (zelf of een beheerder), waar
het lid voor het laatst gezien is, en wie er niet meer in de server zit. Handmatig koppelen kan
daar ook, voor een lid dat het zelf niet lukt. Eén OSRS-naam kan maar aan één Discord-account
vastzitten; de tweede poging wordt geweigerd in plaats van stilletjes overgenomen.

### Wat de bot niet aanraakt

- **Alleen de rollen die hier zijn ingesteld.** De clanrollen en de gastrol, en verder niets.
  Een lid dat daarnaast `@Eventteam` of `@Corporal` heeft, houdt die — ook bij een promotie, een
  degradatie of het verlaten van de clan.
- **Alleen gekoppelde leden.** Wie geen naam heeft opgegeven blijft buiten schot. In het
  voorbeeld zie je wel welke clanleden nog geen koppeling hebben.
- **Niets zonder dat het kan.** Een rol boven de rol van de bot, of een lid dat boven hem
  staat: dat staat in het voorbeeld als waarschuwing, in plaats van dat het halverwege misgaat.
- **Niets bij een halve ledenlijst.** Lukt het ophalen van één van de gekozen clans niet, dan
  stopt de hele ronde met een melding. Anders zou die clan er even uitzien als leeg, en raakt
  iedereen daaruit zijn rol kwijt.

### Waar de gegevens vandaan komen

De openbare API van WiseOldMan, zonder account:

| Waarvoor | Adres |
| --- | --- |
| Clan zoeken op naam | `api.wiseoldman.net/v2/groups?name=...` |
| Ledenlijst met ieders rang | `api.wiseoldman.net/v2/groups/<id>` |
| In welke clans zit deze speler | `api.wiseoldman.net/v2/players/<naam>/groups` |

Het nummer van je clan staat in de URL op de site: `wiseoldman.net/groups/139` → 139. Zoeken in
het dashboard doet dat voor je.

Ledenlijsten worden vijf minuten onthouden, zodat het openen van een scherm niet elke keer een
verzoek is. **Vernieuwen** en `/clan sync` halen ze altijd vers op. Zonder API-sleutel laat
WiseOldMan twintig verzoeken per minuut toe; loop je daar tegenaan, dan zegt de bot dat met
zoveel woorden. Een sleutel (te krijgen in hun Discord) zet je in `WOM_API_KEY`.

### Vanzelf bijwerken

Rangen veranderen in het spel, en daar komt geen Discord-melding van. Staat **Elk uur vanzelf
bijwerken** aan, dan loopt de bot dat interval langs alle servers waar dat aanstaat. Het
interval zet je met `CLAN_SYNC_MINUTEN` (0 = nooit). Zowel `npm start` als `npm run dashboard`
doet dit; draai je ze allebei tegelijk, zet het dan in één van de twee uit.

### Opslag

Eén JSON-bestand per server in `CLAN_DIR` (standaard `./clan`, of `clan/` op een aangekoppeld
volume). Daarin staan de gekozen clans, de rolkoppelingen en de leden. Te openen, te kopiëren en
met de hand te repareren. Staat er onzin in, dan stopt de bot met een melding in plaats van het
als leeg te lezen — anders zou de eerstvolgende synchronisatie iedereen zijn rol afnemen.

### Rechten

De bot heeft **Rollen beheren** nodig, en zijn eigen rol moet bóven de rollen staan die hij
uitdeelt. Voor het gelijktrekken van bijnamen komt daar **Bijnamen beheren** bij. De eigenaar
van de server kan door niemand hernoemd worden, ook niet door een bot met alle rechten; zijn
rollen lukken wel. Er is geen privileged intent nodig: de bot haalt alleen de leden op die
gekoppeld zijn, op id.

## Wat er is blijven liggen

Een server groeit dicht: kanalen waar al een half jaar niets gebeurt, rollen die niemand meer
heeft, uitnodigingen die nooit verlopen, webhooks waarvan niemand weet waar ze vandaan komen.
Niets daarvan is kapot, dus niemand ruimt het op — je komt er alleen achter als je er expres
naar gaat zoeken.

Op het serverscherm staat dat zoeken als lijst. Stil betekent zestig dagen geen bericht;
kanalen waar nooit iets in gezegd is staan er apart bij, want dat is iets anders dan "ooit
druk, nu stil". Opruimen doe je zelf in Discord — de bot kijkt alleen.

Twee dingen kan hij niet altijd zien, en dan zegt hij dat in plaats van te zwijgen: rollen
zonder leden vragen de Server Members Intent, en webhooks het recht **Webhooks beheren**.

## Vanzelf een momentopname

Er werd alleen een back-up gemaakt vlak voor een uitrol of een leeghaal. Gebeurt er een maand
niets en gaat er dan iets mis, dan is je laatste momentopname een maand oud — of is er geen.

Standaard maakt de bot er daarom elke week zelf een van elke server (`BACKUP_UREN`, 0 is uit).
De laatste acht per server blijven staan (`BACKUP_BEWAAR`); wat daarvoor zit gaat weg, anders
loopt een volume vol met bestanden die niemand ooit opent. Opgeruimd wordt alleen wat vanzelf
gemaakt is — een back-up van vlak voor een uitrol blijft staan, want die heb je juist bewaard
omdat er iets stond te gebeuren.

## Zelf kijken of een server afdwaalt

Een server dwaalt af zonder dat iemand het merkt: een kanaal erbij, een recht eraf, een naam
veranderd. Het dashboard laat dat zien zodra je kijkt — maar je kijkt pas als je al iets
vermoedt.

Dus kijkt de bot zelf. Standaard elk etmaal (`DRIFT_CHECK_UREN`, 0 is uit) vergelijkt hij elke
server met de template die er het laatst echt op ging — uit het logboek, dus een preview telt
niet mee. Wijkt er iets af, dan zegt hij dat in de server zelf: in het systeemkanaal, anders in
het eerste kanaal waar hij mag praten, anders als DM naar de eigenaar.

Alleen als er iets verandert. Dezelfde afwijking elke dag opnieuw melden is geen melding meer
maar behang, dus hij onthoudt wat hij gemeld heeft in `drift-gemeld.json` naast het logboek. Gaat
het aantal omhoog of omlaag, of ging er een andere template op, dan hoor je het. Klopt de server
weer, dan hoor je dat ook — één keer.

**Per server uit te zetten.** Op een server die je aan het verbouwen bent klopt dat bericht juist
niet: je hoort dan elke keer wat er "nog niet" staat, terwijl je het zelf anders hebt bedoeld. In
het dashboard, onder **Servers → die server → Deze server**, zet je het melden voor die ene server
uit. Het getal blijft gewoon in het dashboard staan — hij zegt er alleen niets meer over, en haalt
voor zo'n server ook geen verse momentopname meer op. De keuze staat in `server-instellingen.json`
naast het logboek; wat er niet in staat meldt gewoon.

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
  commands/clan.ts      /clan: koppelen, bijwerken en opzoeken van clanrangen
  events/guildMemberAdd.ts  nieuwe leden begroeten met de koppelknop
  clan/wiseoldman.ts    de WiseOldMan-API: clans zoeken, ledenlijst, met cache
  clan/koppelen.ts      een naam koppelen en er meteen de juiste rollen bij zetten
  clan/knop.ts          de knop "Koppel je OSRS-naam" en het venstertje erachter
  clan/rangen.ts        clanrang + instellingen -> welke rol, als plan
  clan/opslag.ts        gekozen clans en koppelingen per server, op schijf
  clan/synchroniseren.ts  plan maken, uitvoeren en elk uur vanzelf bijwerken
  events/guildCreate.ts zelfcontrole en welkomstbericht bij het joinen
  dashboard.ts          start de bot met het lokale dashboard ernaast
  dashboard/server.ts   API voor templates, plannen, controleren en toepassen
  dashboard/index.html  de dashboardpagina (geen buildstap, geen dependencies)
  dashboard/app.js      dashboardlogica in de browser
  dashboard/editor.js   de klik-editor voor rollen, kanalen en permissies
  dashboard/ui.js       iconen, meldingen, dialogen en het thema
  dashboard/clan.js     het clanscherm: clans kiezen, rangen, leden en bijwerken
  util/intents.ts       welke intents de bot mag vragen, volgens het portal
assets/logo.png         avatar en applicatie-icoon
  types.ts              zod-schema en validatie van templates
  commandos.ts          de slash-commando's aanmelden, en alleen als er iets veranderd is
  taal.ts               alle teksten voor leden, in het Nederlands en het Engels
  templates.ts          templates inlezen uit de map
  overerven.ts          een template die op een andere voortbouwt samenvoegen
  negeren.ts            wat de bot met rust laat: namen, sterren en wat erin staat
  rolmenu.ts            het bericht met rolknoppen bouwen, teruglezen en vergelijken
  rolmenuKlik.ts        wat er gebeurt als iemand op zo'n knop klikt
  variabelen.ts         {{naam}} in een template invullen
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
  uitvoeren.ts          de volgorde van een uitrol, op één plek
  gepland.ts            uitrollen op een tijdstip, ook na een herstart
  drift.ts              wijkt een server af van wat er het laatst op ging?
  serverInstellingen.ts wat je per server anders wil, zoals het melden uitzetten
  driftWacht.ts         daar vanzelf over melden in de server
  backupWacht.ts        vanzelf een momentopname, en oude opruimen
  auditlog.ts           wie heeft er met de hand iets veranderd
  opruimen.ts           kanalen en rollen waar niets meer mee gebeurt
  importeren.ts         een Discord-template-link naar onze vorm
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

### Live zetten op Railway

`railway.json` staat in de repo, dus Railway bouwt met `npm run build` en start met
`npm run start:dashboard` — één proces met de bot én het dashboard erin, dus `/setup` werkt
ook gewoon. De poort komt uit `PORT`, die Railway zelf invult; daar hoef je niets voor te doen.

Onder **Variables** zet je dit (Raw editor → plakken):

```env
DISCORD_TOKEN=de-token-uit-het-developer-portal
DISCORD_CLIENT_ID=het-application-id
DISCORD_CLIENT_SECRET=de-client-secret
DASHBOARD_HOST=0.0.0.0
DASHBOARD_URL=https://jouw-project.up.railway.app
GUILD_IDS=
DASHBOARD_OWNERS=
TEMPLATES_DIR=./templates
BACKUPS_DIR=./backups
HISTORY_DIR=./history
```

- `DASHBOARD_HOST=0.0.0.0` is nodig, anders praat het dashboard alleen tegen zichzelf en
  krijgt de bezoeker niets. Daarom is `DISCORD_CLIENT_SECRET` hier ook verplicht: buiten je
  eigen computer weigert het dashboard te starten zonder inloggen.
- `DASHBOARD_URL` is het adres dat Railway je geeft (Settings → Networking → Generate Domain).
  Zet exact dat adres + `/auth/callback` in het Developer Portal onder **OAuth2 → Redirects**.
  Dat is de meestgemaakte fout: wijkt er één letter af, dan weigert Discord de inlog met
  *"Ongeldige OAuth2 redirect_uri"*. Welk adres hij stuurt zie je op `/api/session`, onder
  `redirectUri` — dat is precies de tekst die in het portal moet staan.
- `GUILD_IDS` leeg = geen beperking. Vul je er server-ids in (met komma's ertussen), dan mag
  de bot alleen daar iets.
- `TEMPLATES_DIR`, `BACKUPS_DIR`, `HISTORY_DIR` en `CLAN_DIR` mag je weglaten zodra er een
  volume hangt — zie hieronder.

#### Een volume, anders ben je alles kwijt bij elke deploy

Railway gooit de schijf leeg bij elke nieuwe deploy. Zonder volume betekent dat: elke template
die je in het dashboard aanpast, elke back-up en de hele uitrolgeschiedenis zijn weg zodra je
iets pusht. Dat merk je pas als je het nodig hebt.

Toevoegen gaat níet via Settings — daar staat het niet. Het zit op het projectoverzicht (de
"canvas" met de blokjes):

- **Op een telefoon:** tik op het **⋯**-menu rechtsboven op het blokje van je service →
  **Attach Volume**.
- **Op een computer:** rechtermuisknop op het blokje van de service → **Attach Volume**. Of
  ⌘K / Ctrl+K en typ "volume".

Als mountpad vul je `/data` in. Kies niet `/app`: daar staat de code zelf. Railway herstart de
service daarna en zet zelf `RAILWAY_VOLUME_MOUNT_PATH=/data` in de omgeving — die hoef je niet
zelf aan te maken.

Meer hoef je niet te doen: staat die variabele er, dan verhuizen templates, back-ups,
geschiedenis en de clankoppelingen vanzelf mee naar `/data/templates`, `/data/backups`,
`/data/history` en `/data/clan`. De
meegeleverde templates worden bij de eerste start naar het lege volume gekopieerd — en daarna
nooit meer, anders zou je eigen versie elke herstart overschreven worden.

Had je `TEMPLATES_DIR`, `BACKUPS_DIR`, `HISTORY_DIR` of `CLAN_DIR` zelf ingevuld? Haal ze dan weg, anders
winnen die van het volume. Heb je liever een ander pad: `DATA_DIR` doet hetzelfde op een host
die geen Railway is.

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

**Commando's aanmelden bij Discord** hoeft meestal niet meer (zie hieronder), maar kan hier
nog: **Actions → Commands registreren → Run workflow**, met een keuze voor `overal`, `alleen in
deze server` of `uit deze server weghalen`. Op een computer doet `npm run deploy` hetzelfde.

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
| `kanalen` | kanalen aanmaken, bijwerken, verwijderen en op volgorde zetten, met hun rechten |
| `automod` | de AutoMod-regels |
| `emojis` | de emoji uit de template |
| `instellingen` | serverinstellingen, het systeem- en regelskanaal, en community-modus |
| `onboarding` | de vragen die nieuwe leden krijgen |
| `rolmenus` | de berichten met knoppen waarmee leden zichzelf een rol geven |

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

**Of vanuit het dashboard:** bij **Servers** heeft elke serverkaart een knop *Leeghalen*. Dat
gaat in twee schermen — eerst kies je wat er weg mag en welke rollen hoe dan ook blijven, dan
zie je precies wat dat oplevert, en pas dan typ je de servernaam over. De knop om door te gaan
blijft grijs tot die naam exact klopt. Ook hier gaat er eerst een momentopname naar `backups/`,
en de uitrol komt bij **Geschiedenis** te staan als `(leeghalen)`.

**Zelf kiezen wat er weg mag.** Standaard gaat alles weg. Wil je bijvoorbeeld de kanalen
opnieuw doen maar de rollen houden — dan hoef je niemand opnieuw een rol te geven — dan zet
je dat ene deel uit:

```bash
npm run reset -- --guild 123456789 --bevestig "Testserver" --behoud-rollen
```

| Vlag | Wat er blijft staan |
| --- | --- |
| `--behoud-rollen` | alle rollen |
| `--behoud-rol "Admin"` | die ene rol; mag vaker, of als `"Admin,Moderator"` |
| `--behoud-kanalen` | alle kanalen en categorieen |
| `--behoud-automod` | de AutoMod-regels |

Een losse rol uitsluiten is handig als je alles opnieuw wilt doen maar je beheerdersrol wilt
houden — die hangt aan je leden, en opnieuw uitdelen is handwerk:

```bash
npm run reset -- --guild 123456789 --bevestig "Testserver" --behoud-rol "Admin,Moderator"
```

In de Action is dat het veld **rollen_behouden**, komma's ertussen. Namen worden vergeleken
zonder te letten op hoofdletters of spaties. Slaat een naam nergens op, dan zegt hij dat
("er is geen rol die \"Moderatr\" heet") in plaats van stil een rol weg te gooien die je
wilde houden.

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

### Variabelen in een template

Dezelfde template op een andere server zetten zonder hem te kopieren: zet er een variabele in.

```json
{
  "name": "{{clan}} server",
  "variables": {
    "clan": { "beschrijving": "Naam van je clan, komt terug in de rolnamen", "standaard": "Clan" }
  },
  "roles": [{ "key": "owner", "name": "{{clan}} Owner" }]
}
```

Invullen gebeurt vóór de controle, op de tekst van het bestand. Alles wat daarna komt — de
rolnamen, topics, kleuren — ziet gewoon de ingevulde waarde, en elke bestaande
controle werkt er zonder aanpassing op. Een waarde met aanhalingstekens erin blijft geldige
JSON.

```bash
npm run apply -- --guild 123 --template gaming --apply --var clan="Bloody Mayhem"
```

In de Action is het het veld **variabelen**: `clan=Bloody Mayhem, kleur=#ff0000`. Zonder
waarde gebruikt hij de standaard uit de template; is er geen standaard, dan stopt hij met de
vraag welke waarden hij nodig heeft — in plaats van een server met `{{clan}}` als rolnaam.
Geef je een naam op die de template niet kent, dan zegt hij dat, met een suggestie.

De meegeleverde `gaming`-template doet dit met `clan`. Zonder waarde heet de rol `Clan Owner`,
net als eerst; met `--var clan="Bloody Mayhem"` wordt het `Bloody Mayhem Owner`.

### Dezelfde weg, welke deur je ook neemt

Een template kan op drie manieren naar binnen: het dashboard, de commandoregel (en daarmee de
GitHub Action) en `/setup apply` in Discord. Alle drie lopen ze nu door dezelfde stappen:

1. template laden en de variabelen invullen;
2. plan berekenen;
3. bijstellen naar wat deze bot op deze server mag;
4. momentopname wegschrijven;
5. uitvoeren;
6. in het logboek zetten, met wat er is overgeslagen.

Dat klinkt vanzelfsprekend, maar was het niet: de slash-commando's sloegen stap 3, 4 en 6 over
en kwamen daardoor nog met de oude fouten terug, en de commandoregel maakte geen momentopname
terwijl het dashboard dat wel deed. In de Action wordt die momentopname als artifact bewaard,
want de schijf van een runner is na afloop weg.

### Bedoelde je ...?

Een naam die net niet klopt kost anders een half uur zoeken. De controle zegt er daarom bij
wat je waarschijnlijk bedoelde — bij permissies, rollen, kanalen en variabelen:

```
- roles.0.permissions: Onbekende permissie(s): MANAGE_SERVER — bedoelde je "ManageGuild"?
- kanaal "C/chan": onbekende rol "moderator" — bedoelde je "mod"?
- guild.systemChannel: onbekend kanaal "welkom-hier" — bedoelde je "welkom"?
```

Hij kent ook de namen die Discord in de app anders schrijft dan in de API: *Manage Server* is
`ManageGuild`, *Manage Emojis* is `ManageGuildExpressions`. Dat zijn geen typefouten maar
synoniemen, en juist die kosten tijd.

### Wat is er eerder uitgerold

Elke uitrol komt in een logboek: welke template, op welke server, door wie, wanneer, hoeveel
acties lukten en wat er is overgeslagen. Ook die vanaf de commandoregel of uit een GitHub
Action — daar staat de GitHub-gebruiker bij. Het dashboard toont de laatste vijftien onder
*Wat is er eerder uitgerold*; het bestand zelf is `history/setups.jsonl`, één regel JSON per
uitrol, ook met de hand te lezen.

### Rolvolgorde en de rolhierarchie

Een bot mag geen rol verplaatsen die even hoog of hoger staat dan zijn eigen rol. Dat geldt
ook met Administrator: die permissie zegt niets over de volgorde.

Discord bewaart per rol een **ruw nummer**, en meerdere rollen mogen hetzelfde nummer hebben
— nieuwe rollen komen er allemaal op 1 in. discord.js rekent daar een nette volgorde van
(`position`), maar de API praat in die ruwe nummers (`rawPosition`). Wie de nette volgorde
terugstuurt mikt dus naast: op een verse server, waar vier nieuwe rollen én de bot allemaal
op ruw nummer 1 staan, belandde rol nummer vier zo boven de bot — en dat weigert Discord met
een kale `Missing Permissions`.

De bot rekent daarom overal met het ruwe nummer, en zet nooit iets op of boven zijn eigen
plek. Alle plekken waar een nummer gebruikt wordt, nagelopen:

| Waar | Welk nummer | Waarom goed |
| --- | --- | --- |
| `orderRoles` (rolvolgorde zetten) | **ruw** | dit gaat naar de API; hier zat de fout |
| `orderChannels` (kanaalvolgorde) | ruw (index per categorie) | kanalen kennen geen hierarchie; alleen ManageChannels nodig |
| `rolesAboveBot` (waarschuwing) | net, aan beide kanten | alleen vergelijken, gaat nergens heen |
| `planReset` (wat mag weg) | net, aan beide kanten | alleen vergelijken |
| `rolesOutOfOrder` / `channelsOutOfOrder` | net | vergelijken; de nette volgorde kent geen gelijkspel en is hier juist beter |
| `snapshot` | allebei, apart benoemd | `position` om te vergelijken, `rawPosition` om terug te sturen |
| `exporter` | net | alleen sorteren |

De momentopname bewaart voortaan allebei de nummers onder hun eigen naam, met uitleg erbij.
Wie er later iets mee doet, ziet meteen welk nummer waarvoor is — dat was de val waar ik zelf
in trapte.

Is er onder de bot geen ruimte, dan probeert hij het niet en zegt hij wat je moet doen:

```
rolvolgorde: Directie, Manager staan even hoog als of hoger dan de rol van de bot en zijn
daarom overgeslagen. Sleep de rol van de bot in Serverinstellingen -> Rollen boven deze
rollen en draai dit opnieuw.
```

De run mislukt daar niet meer op: de rest van de server staat er gewoon, en dit staat als
losse melding boven aan de Action.

### Waar je de meldingen ziet

Op een telefoon is het log niet te doen. Daarom staat alles wat aandacht vraagt op twee
plekken die je ziet zonder te scrollen:

- **De gekleurde balk boven aan de run.** Elke melding komt daar als annotatie te staan —
  geel als er iets is overgeslagen, rood als er echt iets mislukte.
- **De samenvatting onder de run.** Een kopje met wat er gelukt is, en daaronder *Let op*
  met de regels die ertoe doen.

In het log staat hetzelfde, met tijdstempels.

### Een community-server leeghalen

Het regels- en updateskanaal van een community-server laat Discord niet verwijderen zolang
die modus aanstaat (`Cannot delete a channel required for community servers`). Leeghalen
betekent leeg, dus zet de bot community-modus eerst uit — dat vraagt Administrator. Lukt dat
niet, dan blijven die twee kanalen staan en zegt hij precies waarom en wat je eraan doet.

Een AutoMod-regel die al weg is (404) telt als opgeruimd, niet als fout. Discord maakt bij
het aanzetten van community-modus zelf regels aan die soms al verdwenen zijn.

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
- **Stickers** vallen buiten deze versie.
- Een **banner** werkt pas vanaf boostniveau 2; zonder boosts negeert Discord het veld.
- De **rolvolgorde** wordt onder de rol van de bot gezet. Staat die te laag, dan wordt de
  volgorde overgeslagen met een melding in plaats van half uitgevoerd.
- Bij grote templates kan Discord's rate limiting het uitvoeren vertragen — dat is normaal,
  discord.js wacht automatisch.
