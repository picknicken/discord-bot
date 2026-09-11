# Discord Server Setup Bot

Een Discord-bot die complete servers inricht vanuit JSON-templates: rollen, categorieen,
kanalen, permissie-overwrites en serverinstellingen — in een keer, reproduceerbaar.

## Wat de bot doet

| Commando | Wat het doet |
| --- | --- |
| `/setup list` | Toont alle beschikbare templates met aantallen rollen/kanalen |
| `/setup preview template:<naam>` | Laat het volledige plan zien **zonder iets te wijzigen** |
| `/setup apply template:<naam> bevestig:<servernaam>` | Voert het plan uit |
| `/setup export` | Exporteert de huidige server als template-bestand (JSON-bijlage) |

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

Gevraagd wordt: `ManageChannels`, `ManageRoles`, `ManageGuild` (verplicht) plus
`ViewChannel`, `SendMessages`, `EmbedLinks`, `AttachFiles`, `ReadMessageHistory` om te
kunnen terugkoppelen. Bewust **geen** Administrator.

Zet `DISCORD_DEV_GUILD_ID` in `.env` tijdens het ontwikkelen: commands zijn dan direct
actief in die ene server, in plaats van de globale registratie die tot een uur kan duren.

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
  gebruikt worden zonder dat je hem definieert.
- `permissions` / `allow` / `deny` — namen uit Discord's permissieset, bijvoorbeeld
  `ViewChannel`, `SendMessages`, `ManageMessages`, `Connect`, `Speak`, `Administrator`.
  Een onbekende naam laat de template bij het laden falen, niet halverwege het uitvoeren.
- `channels[].type` — `text`, `voice`, `forum`, `announcement` of `stage`.
- `slowmodeSeconds` (0–21600), `userLimit` (0–99, voice/stage), `nsfw`, `topic`.

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
zonder gateway-verbinding.

## Projectstructuur

```
src/
  index.ts              bot-client en interaction-routing
  deploy-commands.ts    slash commands registreren
  configure-install.ts  default install-settings (rechten bij elke join) zetten
  invite.ts             invite-link printen
  botPermissions.ts     de enige lijst met rechten die de bot vraagt
  commands/setup.ts     /setup met list, preview, apply, export
  events/guildCreate.ts zelfcontrole en welkomstbericht bij het joinen
  types.ts              zod-schema en validatie van templates
  templates.ts          templates inlezen uit de map
  snapshot.ts           bestaande server -> platte structuur
  planner.ts            snapshot + template -> plan
  applier.ts            plan uitvoeren via de Discord API
  exporter.ts           bestaande server -> template
  permissions.ts        permissienamen <-> bitfields
templates/              meegeleverde templates
tests/                  vitest-tests voor schema, planner en rechten
```

## Ontwikkelen

```bash
npm run typecheck
npm test
npm run build
```

## Bekende grenzen

- Discord staat maximaal 500 kanalen en 250 rollen per server toe; de planner waarschuwt
  als een template daar overheen gaat.
- Emoji's, stickers, automod-regels en onboarding vallen buiten deze versie.
- Kanaalvolgorde binnen een categorie volgt de volgorde in de template bij aanmaken;
  bestaande kanalen worden niet herordend.
- Bij grote templates kan Discord's rate limiting het uitvoeren vertragen — dat is normaal,
  discord.js wacht automatisch.
