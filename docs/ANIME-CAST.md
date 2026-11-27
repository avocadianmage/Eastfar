# The anime cast: handoff

Written on 27 November 2026 by the Claude session that built Eastfar in a cloud container, for the session that continues on the owner's own computer. That session starts with none of the earlier conversation, so everything it needs is here, in `CLAUDE.md` and in `docs/DESIGN.md`.

**Status (27 November 2026, evening): all eight characters are made, in the game, and approved by the owner** (*"things are looking good with the cast overall"*), who then asked for the fixes from a first look (eyes drawn properly, Pip's head smaller, seated skirts, stiff arms) and for the work to be committed and pushed. The owner approved the pilot (Wren, after she was given leggings and long hair) and asked for the other seven to be made and put in the game, all with long hair and all beautiful. Each is `art/vroid/<id>.vroid` and `art/vroid/<id>.vrm`; how each was made is in "How the cast was made" below, and pictures from all sides are in `shots/vroid/<name>-turn.png` and `-close.png`. The game-side work (build, shading, springs, seated poses) is on the `anime-cast` branch and described in `docs/DESIGN.md` and `art/vroid/GAME-SIDE-NOTES.md`. It is merged into `main` and live.

## What was decided

The owner's words: *"for all the characters, I'd like to actually have them be beautiful anime girls (not copying or anything, but similar in style to like Genshin Impact)"* and *"Needs to be high quality and well done."*

1. **Every person in the game becomes an anime-style female character**: original designs, cel-shaded, in the manner of modern anime games. Nothing is copied from any existing game: no existing character, outfit, emblem or name.
2. **The models are made in VRoid Studio** (pixiv's free character maker), on the owner's computer, **by Claude through computer use**, with the owner approving the look at checkpoints. Reason: nobody can model a good anime face in code, and VRoid Studio is built for exactly this style.
3. **Claude builds everything around the models**: bringing them into the game, animation, the cel shading, faces that blink and talk, hair and skirts that move, and the cast's names and lines.
4. **The cast** (confirmed by the owner): the beekeeper, the blacksmith and the farmer Dorrin, who were men, become women with new names and lines. Pip stays a child. The scarecrows stay scarecrows.
5. **Licence**: the code is GPL-3.0-or-later; the art has its own terms (see "Licence rules" below). The owner asked to *"make sure we can use newer avatars with VRoid"*: we can, under pixiv's conditions, which is why the characters must never be marked CC0 or GPL.
6. **After the pilot** (26–27 November): Wren's skirt became leggings at the owner's request (*"Give her pants instead of a skirt"*, *"Leggings"*), and then: *"I approve so please proceed with putting her in the game and building out the rest of the characters too. Make sure all characters have long hair and look beautiful (it is OK for the elder to be old)."* So every character has hair well past the shoulders, and the checkpoints between the pilot and the finished cast were waived. The one before merging to `main` was not.

## Setting up (for the owner)

1. Install [Git](https://git-scm.com), [Node.js 22](https://nodejs.org), [VRoid Studio](https://vroid.com/en/studio) and the Claude desktop app.
2. Get the game running:

   ```bash
   git clone https://github.com/avocadianmage/Eastfar.git
   cd Eastfar
   npm ci
   npx playwright install chromium
   npm test
   npm run dev
   ```

   The game is then at http://localhost:5173.
3. In the Claude desktop app, turn on Computer use (Settings → System → Computer use, or Settings → Capabilities → Computer use), and open the cloned folder as a Code session. Computer use works through the desktop app, not through a bare terminal.
4. Open VRoid Studio yourself and get it to its start screen: accept its Terms of Use and sign in if it asks. Agreeing to terms is yours to do, not Claude's.
5. Start the session with:

   > Read docs/ANIME-CAST.md, then begin the first session: check the setup, explore VRoid Studio, and make the pilot character.

Things only you can do: approve Claude's access to VRoid Studio when asked, keep the computer free while Claude is driving it, judge the look at each checkpoint, and back up the `art/vroid/` folder (it is not in git; see "Where files go").

## For Claude: how to work here

- Read `CLAUDE.md` and the Status table of `docs/DESIGN.md` first. `CLAUDE.md` lists the commands and conventions.
- **Computer use.** Load the computer-use skill before the first action. Ask for access to VRoid Studio only (its name for the access request is `VRoidStudio 2.17.0`, as in the Start menu). Look at the screen before saying what the app can or cannot do. "VRoid Studio as found" below is what the first session saw in version 2.17.0; anything not listed there is still unchecked.
- **Do precise work in files, not with the mouse.** Good with computer use: choosing presets, typing numbers into slider fields, entering colour codes, importing and exporting files. Poor: freehand drawing of hair strands, painting with the in-app brush. Paint clothing and face textures as image files with code (VRoid Studio can export a texture layer as a guide and import a finished image) and build hair from presets with adjustments.
- **Nobody has driven VRoid Studio this way before.** The first character is a trial of the method as much as of the look. If it turns out not to work well enough, say so plainly and use the fallback below; do not push on producing poor characters.
- **Checkpoints with the owner.** The pilot was approved and the intermediate checkpoints were waived (see "What was decided", 6). What remains: show the owner the whole cast in the game and wait for a yes before anything goes to `main`.
- **The owner reports problems with screenshots.** Reproduce the exact view before theorising. Lessons from this project that cost a round each: check one textured thing close up, not a field of them (the flower paintings were upside down for a whole round and read as "overlapping plants"); `tools/probe.mjs` runs at low quality with the grass left out unless told otherwise, so pass `quality=high&skip=none` for triangle counts; do not push before the full end-to-end run has finished when a budget could be affected; geometry wound inside-out hides its near faces, so look at the bare mesh when something "pokes through".
- **Git.** Pushes to `main` deploy to the public site at once. A half-changed cast should not go live: work on a branch until the owner has approved the look, unless the owner says otherwise.
- **This machine is not the cloud sandbox the game was built in.** There is a real GPU, so frame rate can finally be measured (the ` key shows the readout). `tools/shots.mjs`, `tools/probe.mjs`, `tools/live.mjs`, `tools/assets/preview.mjs` and `playwright.config.ts` all start the browser with software-rendering flags (`--use-angle=swiftshader` and friends); they still work, slowly, and the flags can be made optional. `NODE_USE_ENV_PROXY=1` was a sandbox need only. `ffmpeg` is needed only to rebuild the sounds. The tools have not been run on Windows or macOS.

### Fallback if computer use cannot do the VRoid work

In order of preference: (a) the owner makes each character in VRoid Studio from the sheets below, with Claude advising from screenshots; (b) the cast is built from pixiv's sample avatars alone, with hair, eye and clothing colours changed by editing the exported textures in the build. (b) needs no VRoid Studio work but gives less distinct faces and hair.

## Licence rules (binding)

Checked on 27 November 2026 against pixiv's pages, and re-read the same afternoon, after all eight characters were made: both unchanged (Guidelines "Edited December 21st, 2023"; sample avatars "Updated on December 26th, 2024"). Conditions can change: re-read both pages again if much time passes before the commit. The cast was made from the Fem base and VRoid Studio's preset items, not from a sample avatar, so it is the Guidelines that apply; the sample-avatar terms matter only if one is used later.

**[VRoid Studio Guidelines](https://vroid.com/en/studio/guidelines)** (edited 21 December 2023):

- Textures and hair meshes you make from scratch are yours. The body mesh, clothing meshes and other preset items are pixiv's: "All content provided by pixiv, including the base models when creating a new avatar, is not CC0."
- "Any individual or corporation may sell or use for commercial purposes any mesh, texture, or preset item provided by VRoid Studio, including models, clothing items, and accessories, provided that no special clauses are indicated in the license." Exported models may be edited in other software and used in games and websites.
- "You cannot create an application that can generate or output 3D models, avatars, or items consisting of deformed or combined meshes and textures that were created in VRoid Studio."

**[Sample avatars VRoidPreset_A–Z](https://vroid.pixiv.help/hc/en-us/articles/4402394424089)** (the newer avatars; updated 26 December 2024):

- "This model's .vroid and VRM files can be used by anyone in any kind of activity, be it for-profit or not." No credit is needed. Editing them into original characters and redistributing the result is expressly allowed.
- Prohibited: "Distributing a sample model or its VRM file to a third party by setting the 'Redistribution and alteration' conditions of use to 'Copyright Disclaimer (CC0)'"; "Development of a character creation service using data contained in the sample model"; "Redistributing the .vroid or VRM file of the sample model (or other data such as image data within the model) in exchange for a fee"; and uses that are hateful, extremist, fraudulent or that suggest pixiv endorses something.

What this means for the repo:

- Character files made with VRoid Studio are **never CC0 and never GPL**. They are listed in their own section of `public/assets/CREDITS.md`, with the sample avatar or presets each was made from, under the wording already in `README.md` ("Licence") and at the top of `CREDITS.md`.
- In VRoid Studio's export screen, never choose the CC0 licence. Choose "Other" where a licence type is asked for and point it at the repository's `README.md`. Put "the Eastfar authors" as author and the repository address as contact: no personal names, e-mail addresses or accounts. (As found: the VRM 1.0 form has no licence-type list and no CC0 choice. It has permission switches, left at their most restrictive defaults, and an "Additional Permission Information URL", which gets the address of `README.md`. Loosening the switches is the owner's decision. See "Export" below.)
- Some preset items carry special clauses of their own. If an item shows one in VRoid Studio, read it before using the item, and write it down in `CREDITS.md`.
- Items bought or downloaded from other creators (for example on BOOTH) have their own licences and usually forbid redistribution: do not use them without the owner's decision.
- The game must not become a character maker: no in-game feature that lets players assemble or export characters from this data.
- Only a few older sample avatars are CC0 (a set is on [OpenGameArt](https://opengameart.org/content/vroid-studio-cc0-models)). They may be used too, and need no special handling.
- New code dependencies must be compatible with GPL version 3. `@pixiv/three-vrm` is MIT, so it is.

## The cast

Art direction for all of them: original, appealing, clean anime faces; each person distinct in outline and in colour so she can be told apart across the village green; practical clothes for a quiet farming village at the edge of a forest. These are working villagers, drawn with warmth.

The colours follow the ones the current villagers wear, so the village keeps its look. Names marked *proposed* were chosen by Claude and are the owner's to change.

| Id in code | Name | Who she is | Look |
|---|---|---|---|
| `elder` | Maelin | Village elder, by the well. The oldest of them ("Old bones want the fire after dark"). | Reads as an elder, not a girl: silver-white hair in a long braid or a bun, calm eyes, a lilac shawl over a pale dress. Lilac and purple. A little shorter than the others. |
| `beekeeper` | Orla (*proposed*; was Orsolt) | Beekeeper at the hives north of the village. Patient, dry. | Sun-browned, honey-blonde hair tied back, amber eyes, a wide straw hat, an ochre smock and gloves. Honey yellow. Sturdy. |
| `herbalist` | Wren Tallow | Herbalist, in her garden. Sharp, a little mercenary. | Auburn hair, green eyes, a moss-green hooded shawl over a cream blouse, a satchel. Green. Slight. |
| `blacksmith` | Brenna (*proposed*; was Bram) | Blacksmith and shopkeeper. Stands with her arms folded. | Tall, strong shoulders, black hair cropped or in a tight high tail, grey eyes, a soot-grey shirt with rolled sleeves, a dark leather apron, boots. Charcoal and rust. |
| `innkeeper` | Hesta | Keeps The Lantern and Loaf. Warm, wistful. | Brown hair in two buns, hazel eyes, a rose dress with a white apron. Rose. |
| `child` | Pip | The weaver's child, about eight. Fearless and nosy. | A child, and must look like one: a child's proportions (she is 0.7 of an adult's height in the game), ginger hair in short pigtails, a sky-blue tunic, leggings and sturdy shoes. Sky blue. |
| `farmer_dorrin` | Dorrie Haywell (*proposed*; was Dorrin) | Farmer, the elder of two sisters (*proposed*; they were husband and wife). Stoic. | Ash-blonde hair in a low braid, a straw hat, a cream work shirt, brown overalls, boots. Wheat and cream. Sturdy. |
| `farmer_marta` | Marta Haywell | Farmer. Watchful; she is the one who says what is wrong at the farms. | Long dark-brown hair under a kerchief, a mauve blouse, an apron skirt. Mauve. |

Also to do, not people:

- **The player's arm** (`src/entities/viewmodel.ts`, `arms.glb`) is a man's forearm today. Replace it with a slender arm and sleeve taken from one of the new models, posed twice as now (a fist, a grip).
- **The scarecrows** keep their bodies and their build (`tools/assets/build.mjs`, the `scarecrow` recipe). They should get the new shading so they sit in the same picture.
- **Aleric**, the founder, appears only as a mossy stone statue and in the lore ("the stone man"). He was not discussed. Leave him as he is unless the owner says otherwise.

Lines that change with the names (`src/data/npcs.ts`, `src/data/quests.ts`): the three `name` fields; Pip's "Bram says there are wolves past the farms. Hesta says there are not. Bram has a sword, so."; Marta's "Dorrin will not say it, so I will."; Dorrin's "Door is barred. Marta's idea. I did not argue." still works. None of the villagers' own lines uses "he" or "she" of themselves. `docs/DESIGN.md` names them in several places. The ids in code (`beekeeper`, `farmer_dorrin` and so on) can stay as they are.

## Where files go

- `art/vroid/` (git-ignored): VRoid Studio's own `.vroid` project files and the raw `.vrm` exports, one pair per character, named by id (`herbalist.vroid`, `herbalist.vrm`). These are the only editable sources of the characters and exist only on the owner's computer: remind the owner to back the folder up. They are kept out of git for size (tens of megabytes each); putting them in is the owner's call.
- `public/assets/characters/`: what the build makes from them, committed, as now.
- Texture images painted by code for import into VRoid Studio: keep the scripts in `tools/assets/` and their output in `art/vroid/textures/`. The script is `tools/assets/paint-vroid.mjs` (one function per character): layers exported from VRoid Studio go in `art/vroid/textures/<piece>-default.png` with their guides as `<piece>-guide.png`, and `node tools/assets/paint-vroid.mjs herbalist` writes the images to import into `art/vroid/textures/herbalist/`.
- Pictures of a raw `.vrm` from any side: `node tools/assets/preview.mjs --viewer=vrm --out=shots/vroid wren="file=herbalist&arms=68&views=full:0,full:90,full:180,face:30,legs:0"` (`tools/assets/vrm-preview.ts`; flat colours, no toon shading).

## VRoid Studio as found (version 2.17.0)

Seen by the first session, driving the app through computer use. Positions are not given: take a screenshot and read them off.

**Verdict on the method: it works.** Presets, typed numbers, colour codes and file dialogs are all reliable through computer use, and the texture editor's import and export make code-painted clothing practical. The pilot took one long session, most of it learning what is written here.

**Driving it**

- Number fields take typed values: click the field, Ctrl+A, type, Enter. Sliders run from about -1 to 1 on the body and 0 to 100 on clothing.
- Colour fields take the six hex digits **without** the `#` (with it the value is rejected).
- File dialogs are the ordinary Windows ones: put the full path in the file-name field and press Enter. They can take a few seconds to appear. Escape closes drop-down lists but not the app's own dialogs: click outside those.
- Save with the menu at the top left (Save; Save As for a new file). Ctrl+S does nothing when a text field has the focus, which is most of the time, so do not rely on it. The title bar shows `*` while there are unsaved changes; check it, or the file's time on disk, after saving.
- **Never type into a dialog that is not up yet.** Save As and the VRM export take several seconds to open their file dialog; text typed before then lands in whatever field had the focus (once it set a body slider to 0, and a Save dialog then opened in a folder of the owner's documents). Take a screenshot, see the dialog, then type the full path. The texture editor's import and export dialogs are quick (3–4 s) and can be chained.
- A click on the main window while one of its modal dialogs is open makes Windows beep. The owner sleeps near the computer: avoid it.
- Clicks that land in a file dialog's sidebar move it to another folder (once into a WSL share). Harmless if the full path is typed, but look before pressing Enter.
- Each character is started from the previous one with Save As, so remove what the new one does not wear (hat, gloves, capelet, undershirt) and reset body sliders that were changed (Brenna's broad shoulders came along to Maelin's copy).
- Back to model selection (in the menu) shows every saved character under "Recently Edited"; a click opens it. Do not start VRoid Studio a second time with `open_application`: that opens another window.
- Camera: the wheel zooms, Shift with a left drag pans. **Turning the camera needs a right-button drag, which computer use does not have**, and nothing else turns it (plain, Alt, Ctrl and Space drags do nothing; the settings have no option). So the editor only ever shows the front. Look at the sides and the back in the exported file with `preview.mjs --viewer=vrm`.
- The Photo Booth (camera icon, top right) shows the character in standing poses and in motion (Animations 1 and 2: standby poses, walking, running, jumping, greetings; and a free "Posing" mode), from the front, with the app's own toon shading. Good for a natural-pose picture and for seeing how a skirt behaves on a walk.

**What there is**

- Start screen: new character from a Fem or Masc base, or one of 26 sample avatars (`AvatarSample_A` to `Z`).
- Tabs: Face, Hairstyle, Body, Outfit, Accessories, Look. Each has categories down the left edge, a list with Presets and Custom tabs, and the chosen item's parameters on the right.
- **Face**: Face Sets (whole faces, two pages) and then each part on its own (eyes, irises, brows, lashes, nose, mouth and so on), each with sliders. The iris colour is one hex field.
- **Hairstyle**: Hairstyle Sets (whole heads of hair, several pages), and parts down the left edge: Front, Back, Overall Hair, Extensions (ponytails, buns), Side, Ahoge and more. The set's Main Color recolours every part; each part also has its own Main and Highlight Color, and a part chosen later keeps the highlight of whatever was there before (an orange highlight followed Orla's hair to Dorrie and Maelin until it was set). Parts mix freely: a set for the front and the buns, then a long Back part, is how Hesta keeps her buns and still has long hair. No hair was drawn by hand and none needs to be.
- **Body**: skin colours; Fem Height (0 is 162.4 cm; -0.1 is 156.4 cm; -0.4 is 139 cm; -1 is 137.7 cm; 1 is 168.2 cm; the height panel counts a hat), Masc Height, Body Size; head size and width; neck; Shoulder Width; chest; Arm Length; hands; Torso Length; Waist Width; Leg Length; Foot Size.
- **Outfit** slots: Whole Sets, Tops, Bottoms, Dresses, Neck Accessories, Arm Accessories, Inner Top, Inner Bottom, Socks, Shoes. **A dress cannot be worn with a top or a bottom**: choosing one removes the other.
- Custom clothes are made from **templates** (Custom, Create New, Choose Template), and an item can stack up to five. Tops: Uniform Vest (and short-sleeved), T-Shirt (and wide-collar, wide-neck with straps, extra short-sleeved, mini, tight-fit), Hoodie, Cardigan, Knit, Coat, Long Coat (high neck, shirt collar, stand-up collar), Female Kimono, Male Kimono, Suit, Blouse (Puff Sleeve), Bolero Jacket. Dresses: Dress (and sleeveless, half-sleeve, short-sleeve, pencil-skirt, cross-back-strap, off-shoulder with and without straps), Leather Suit, Jumpsuit. Neck: Short Tie, Pussycat Bow, Necktie, String Tie.
- **Layering**: Choose Template has "Pick from another category", so a Tops template can be created in the Neck Accessories slot and worn **over** a top. That is how Wren's cape sits over her blouse, and it is the way to make shawls, capes, vests and aprons for the others.
- **Accessories**: glasses (thick, thin), furry ears, tails (cat, fox, rabbit) and hats (Cap, Top Hat, Hat, Witch Hat, Army Cap), plus "Import as Custom Item". **No bags, tools or jewellery**: a satchel has to be a prop added in the game. An accessory is removed by right-clicking it in the list (Remove). The plain "Hat" is a wide-brimmed sun hat; its texture (512 x 1024) is two discs, the outside above (the crown's top within radius 80 of (256, 300), its side to 130, the brim to 258) and the underside below, centred (256, 790); an imported image is shown as it is, not tinted by the hat's Color. It sits above the hair without clipping, but a high ponytail comes through the brim.
- **Neck Accessories** presets are only ties, bows and brooches; capes and shawls are made from templates (Wren's capelet, reused for Maelin). **Socks** includes tights (one with a garter belt, painted over flat for Maelin and Pip). **Arm Accessories** includes long gloves made on the Body Suit template.
- **Look**: outline widths (hair, face, body, accessory), rim light, shading, eye alignment, bones.

**The texture editor** (Edit Texture on any item)

- One layer list per template. Right-click a layer for Import, Export and Export Guide (and "Import from Closet", not used).
- Sizes: 2048 x 2048 for tops; 1024 x 1024 for the skirt; 512 x 1024 for the boots.
- The guide image is solid black outside the pieces of the layout and clear inside them with thin mesh lines. `paint-vroid.mjs` reads the pieces from it (`islands()`), so a cut can be limited to one sleeve.
- **Transparency removes cloth.** pixiv's own presets shape hems this way. A garment is shortened or reshaped by painting the unwanted part transparent, and the export then deletes those triangles.
- Closing the editor asks which items to save. "Overwrite" updates custom items and saves edited presets as new custom items. An item's parameters are saved separately, with "Overwrite item" on the right of the main screen.
- Garments have thickness and an order: the Long Coat family is thicker than the Hoodie and pokes through one worn over it. The cure is to widen the outer garment (Hoodie: Hem Spread and Waist Width at 100) and cut away the part of the inner one that is covered.
- Look at a preset's texture before trusting it: the plain-looking brown lace-up boots turned out to be sweets-themed, with coloured sugar-drop studs and sprinkles.
- **Transparency adds cloth too, the other way round**: a preset whose texture is transparent over part of its mesh (the pale pink dress is strapless, its bodice top and sleeves see-through) gets that cloth back when the part is painted opaque. Pip's round neckline and short sleeves were made this way.
- **The skin under a Body Suit is hidden.** Cutting gloves away at the wrist leaves no hands at all; paint the hand part of the glove in skin colours instead (Maelin's sleeves).
- **Painting in body space.** `surface()` in `paint-vroid.mjs` reads an exported VRM and gives, for every texel of one material, where it sits on the body (metres, T-pose) and which way it faces. A pattern can then be drawn by position: Brenna's leather apron runs across her shirt and trousers, which have unrelated layouts, and Maelin's sleeves end exactly at the wrist. Any export of the character serves (the texture does not change the shape); drafts for measuring go to `art/vroid/textures/<id>-draft.vrm`, never to `art/vroid/<id>.vrm`, which the game build picks up.
- Closing the editor: "Save as new item" whenever the item came from another character (custom items are shared by every file; "Overwrite" would change Wren's capelet in her own closet too). "Overwrite" only for an item made for this character. The buttons move with the number of items listed: screenshot the dialog before clicking.
- Two ramps in one layer (dark parts one colour, light parts another) must take their masks from the layer as it was, not after the first ramp, or the second recolours what the first painted (`splitAt()`).

**Export** (share icon, top right, "Export as VRM"; the other entry, "Upload to VRoid Hub", publishes and is never to be used)

- Reduce Polygons: Edit Hair Cross-Section, Delete Transparent Meshes (on by default), and sliders for Hair Smoothness, Hair, Face, Body, Outfit. Reduce Materials: Materials (Default, 2, 8, 12), Combine Hair Mesh (on by default), Texture Quality (Original, Shrinked). Reduce Bones: Hair (1 or more per group).
- Then a "VRM Settings" form: format VRM1.0 (the default) or VRM0.0; Avatar Name and Creators (both required), Version, Creator Copyright, Contact Information, References, Third Party License; Avatar Use Permissions (Creator only, Users Granted Permission, Everyone); four content permissions; Commercial Use (personal non-commercial only, individuals, individuals and corporations); Redistribution; Alterations; Attribution; Additional Permission Information URL. There is no CC0 choice in the 1.0 form.
- What goes in: the character's name; version 1; creators "the Eastfar authors"; contact `https://github.com/avocadianmage/Eastfar`; third-party note "Made in VRoid Studio 2.17.0 from its preset items (pixiv Inc.), used under VRoid Studio's conditions of use."; every permission left at its restrictive default; the URL `https://github.com/avocadianmage/Eastfar/blob/main/README.md`. The form remembers these for the rest of the session.

## How the cast was made

So that each can be remade or adjusted. All start from the Fem base (each from the one before, with Save As). Every painted texture comes from `node tools/assets/paint-vroid.mjs <id>`, which holds the exact colours, cuts and the layers each one starts from; the layers exported from VRoid Studio are in `art/vroid/textures/`. Face sets are named by the letter used while working (positions in the Face Sets list differ with its scroll; take a screenshot). All wear the brown lace-up Long Boots with brass studs from Wren's recipe. No item from another creator was used, and none of the preset items used showed a special clause.

| Character | Face, eyes | Hair (Main Color) | Body | Clothes | Size of the export |
|---|---|---|---|---|---|
| **Wren** (`herbalist`) | Face Sets, second page, fourth row, left; iris `3FA05C` | Long straight set with front locks, Front with a small braid; `A6482C` | Fem Height -0.1, Shoulder Width -0.3, Waist Width -0.3 | Moss-green hooded capelet (Hoodie template in Neck Accessories, Hem Spread and Waist Width 100, cut to the elbow, cream trim); cream blouse (Long Coat (Shirt Collar)), cut away under the capelet; forest-green leggings (Body Suit "Skinny Pants"), cut just under the boot tops (row 1705) so they do not show through the backs of the boots | 45,246 triangles, 15 materials |
| **Hesta** (`innkeeper`) | Face set K (shiny, friendly); `A07A3C` | Set with two buns and short braids, Back long wavy; `80502E` | Fem Height 0.02 | The apron dress preset, Skirt Length 60, rose `DD8FA0` with its whites warmed to cream (all five layers) | 45,536 / 17 |
| **Marta Haywell** (`farmer_marta`) | Face set J (calm); `5E86B4` | Long side-swept set; `4B3024` | Fem Height 0.06 | Corset-blouse preset in mauve (gold trim and leather kept); belted-skirt preset, its three Skirt Length fields at 45, mauve panels over a plum skirt. No kerchief: there is no template for one | 55,196 / 20 |
| **Dorrie Haywell** (`farmer_dorrin`) | Face set H (bright, cheerful); `6FA3D6` | Front soft side-swept, Back long straight (her twin braids only reached the shoulder blades); `D2BC8E`, highlight `EBDDB8` | Fem Height 0.1 | Shirt-and-waistcoat preset: cream shirt with leather sleeve garters, ochre neckerchief, wheat waistcoat with brown plaid lapels, its long back tails cut level with the front points; grey "Pants (No Crease)" preset in brown; the Hat accessory as a straw hat with a cornflower ribbon (`strawHat()`) | 42,167 → 59,159 with the long hair / 18 |
| **Orla** (`beekeeper`) | Face set D (round, cute); `D9972B` | The braid set for its blunt fringe, Back long hair braided at the ends (first page of Back, third row, left); `E6B755`. A high ponytail came through the hat | Skin `EFCBA6`, shade `D79C7E`; Fem Height 0.04 | The white cable-knit turtleneck preset in honey ochre (its lavender shade colour set to `E3BE94` in the editor); it ends at the waist, so the tank top from Inner Top is under it as a ribbed cream undershirt; olive trousers; the long gloves (Arm Accessories) as pale leather; straw hat with a dark brown band | 46,462 / 17 |
| **Brenna** (`blacksmith`) | Face set G (cat-like, confident); `8C98A6` | The long high twin-tail set (first page, seventh row, left); `2E2B33` | Skin `F8E2CE`, shade `E2AE96`; Fem Height 1 (the tallest, 168 cm), Shoulder Width 0.15 | White long-sleeved shirt preset, Sleeve Roll Up 85 and Sleeve (Shorter) 55, in soot grey; a stitched dark leather apron painted across shirt and trousers by position (`apron()`: bib from the upper chest, straps to the neck, a band round the waist, skirt to mid-thigh); charcoal trousers; the long gloves as leather gauntlets | 51,122 / 16 |
| **Maelin** (`elder`) | Face set A (sleepy, mature), Move Upper Eyelid Down 0.35; `8E7FB0` | The bun set with its Extensions (the buns) removed, Back long straight, Front soft parted; `E4E1EA`, highlight `B9AFCB` | Skin `FAEADB`, shade `E5B5A3`; Fem Height -0.1; Shoulder Width back to -0.3 | The white long dress preset at Skirt Length 100 in ivory with a lilac hem line; Wren's capelet in lilac over it (it hides the dress's keyhole and chest badge); the long gloves as ivory sleeves with lilac cuffs ending at the wrist, hands painted in her skin colours; dove-grey tights | 43,127 / 16 |
| **Pip** (`child`) | Face set D; `4E9E6C` | Long twin tails with an ahoge (Hairstyle Sets, fourth row from the end, left), Front blunt fringe; `D9763A`, fringe highlight `F2A462` | Fem Height -1, Head Size -0.45, Neck Length -0.3, Chest Size -1, Arm Length -0.15, Hand Size -0.2, Leg Length -0.3. Head Size 0 is an adult's head, which Fem Height does not shrink: at a child's height it read as an adult body shrunk under an adult head; -0.45 makes the head about a sixth of her height | The white long-sleeved shirt preset with sky-blue stripes (ringed round the sleeves) and the "Pants (No Crease)" preset, with denim overalls painted on by position: bib with a stitched pocket and brass buttons, straps crossing at the back, a heart patched on her left knee (`child()`, from a draft export) | 40,169 / 14 |

Heights in the exports (top of the head bone + 0.2 m, as the viewer reports): Wren and Maelin 1.54 m, Hesta, Marta, Dorrie and Orla 1.60 m, Brenna 1.66 m, Pip 1.08 m (the game scales her to 1.16 m).

**The player's arm** is Dorrie's whole right arm (`ARM_SOURCE` in `build-vrm.mjs`) with her shirt sleeve recoloured a dusky blue (`ARM_SLEEVE`) so it does not read as skin, and her bare hand, drawn 1.3 times larger than modelled (`HAND_SCALE`; the thumb beyond its first joint is drawn at 0.85 of that, `THUMB_SCALE`). Her sleeve is full, its end about 13 by 10 cm round a wrist of 4 by 6, so from the eye one looked into it past the hand: the build gathers its last few centimetres in to the wrist (`cuffGather`, `CUFF_GATHER`, `CUFF_ROOM`), fitting an ellipse to the sleeve's end and one round the wrist and palm, carrying the one onto the other and letting the cuff out round the thumb's root; the rest of the sleeve, up to the shoulder, is measured slice by slice along the arm and redrawn as an even tube round the arm's line, the cuff's size at the wrist and a fifth wider by the shoulder (`SLEEVE_FLARE`), so the arm suits the hand from every side and runs smoothly into the cuff. VRoid leaves out the skin under clothes, so the build keeps what there is just inside the cuff rather than dropping it as covered; the build curls the fingers into a fist and a grip (`HAND_POSES`, the fist's thumb found by a small search so it wraps across the curled fingers and ends short of the fist's front), both held thumb-up with the back of the hand to the right. In the game (`src/entities/viewmodel.ts`) it is drawn 1.3 times life size and aimed every frame from the hand back to a shoulder point below and right of the eye, so a punch reaches out from the shoulder and a sword cut rolls the arm and tips the blade, and the arm's far end never comes into view. **The scarecrows** keep their pack bodies and get the same cel shading and outline (`celPackMaterials()`).

**Judgements the owner may want to revisit**: Maelin reads as a serene silver-haired woman rather than a visibly old one (allowed, not required, by the owner's words); she can be aged further with the face sliders or painted lines. Brenna's apron is painted on, so from the front her thighs read as leather with the gap between them open, more bib-overalls than a hanging apron. Orla's sweater is cropped, with the undershirt showing at the waist. Two characters have straw hats (the Haywell sister and the beekeeper, both outdoor workers).

## The technical route

A plan, not built. Change it where the first character shows it is wrong, and record the change in `docs/DESIGN.md`.

**Today's people** (read these first): `tools/assets/build.mjs` builds each villager from Quaternius's CC0 packs according to `tools/assets/recipes.mjs`: one mesh on a shared 65-bone skeleton, one colour atlas for everybody, tints baked into vertex colours, three levels of detail, compressed; and it retargets the CC0 animation clips onto each body in the build. `src/assets/loader.ts` loads them; `src/entities/character.ts` plays them (cross-fades, level of detail at 13 m and 42 m, head turning); `src/entities/npc.ts` gives villagers their behaviour; `src/render/characterMaterial.ts` shades them with the game's own light (`src/render/env.ts`, `src/render/lamps.ts`: sun and moon, sky, fog, hearths, the player's lantern). `tools/assets/preview.mjs` photographs one built character in a bare viewer. Tests that know about the models: `tests/unit/assets.test.ts`, `tests/e2e/play.spec.ts`, `tests/e2e/farms.spec.ts`.

**Bringing a VRoid model in.** A `.vrm` file is a glTF binary with extra blocks describing the humanoid bones, the face expressions, the hair and skirt "spring" bones and the toon material settings. Write `tools/assets/build-vrm.mjs` beside the current build:

- Read the `.vrm` with `@gltf-transform` (already a dev dependency), map its humanoid bones to one fixed list of names shared by all characters, and keep each character's hair and skirt bones and their spring settings.
- Keep a handful of face expressions as morph targets (blink, the five mouth shapes, one or two moods) and drop the rest; give only the nearest level of detail morph targets.
- Make three levels of detail, pack the textures (WebP, through `sharp`), compress with meshopt, as the current build does.
- The exports are VRM 1.0 (the model faces +z, in a T-pose, with unrotated bones). VRM 0.x models face the other way; do not mix them.
- VRoid Studio's export screen has options to cut polygons, merge materials and textures, and cut hair bones. The pilot was exported with none of them (only "Delete Transparent Meshes", which is on by default), so the source stays rich and the build does the cutting: Wren is 46,687 triangles, 15 materials and 25 textures in a 17.5 MB file, against a budget of about 14,000 triangles near. Three meshes (face, body with clothes, hair), 116 bones of which 54 are humanoid, 57 face morph targets, 14 expressions, 23 spring chains with 22 colliders. Every material is cut-out (`MASK`) or blended; clothing and hair are double-sided.

**Animation.** Keep the existing CC0 clips (idle, talking, walking, sitting, farm work; see `CLIPS` in `recipes.mjs`) and retarget them onto each VRoid body in the build, the way `build.mjs` already retargets between its two bodies (in model space, with the hips' travel scaled to the leg length). Check hands and shoulders closely: the clips were made for a different skeleton.

**The look.** A new material in the game's shading language (TSL), replacing `characterMaterial.ts` for people:

- two-tone shading with a soft step, using the game's own sun, sky, lamp and lantern light so characters sit in the world at noon, dusk, by a hearth and by lantern;
- ink outlines (a second, slightly larger, back-facing copy of the mesh), on the nearest level of detail only;
- faces shaded smoothly and simply, without the harsh shadows a real nose and cheek would cast;
- a highlight band on the hair and a thin rim of light on the side away from the sun;
- the toon settings stored in each `.vrm` (shade colour, outline width, rim) as the starting values.

`@pixiv/three-vrm` can load `.vrm` files directly and has a toon material for the WebGPU renderer (`MToonNodeMaterial`, three.js r167 or later; the game is on r187). Use it as a reference, or adopt it if the home-made route stalls. The reason to prefer the home-made route is that the game has one lighting model and small downloads, and the library's material knows nothing of the game's fog, lamps and lantern.

**Life.** Blinking at random intervals; mouth shapes while the dialogue box is open; hair and skirts swaying on their spring bones (a simple chain simulation, nearest level of detail only); the head still turns to the player as now.

**Budgets** (from `CLAUDE.md`: 8.3 ms a frame at High, at most 250 draw calls and 1.5 M triangles): a character at about 14,000 triangles near, 5,000 at middle distance, 1,500 far; outlines double the near figure. The village green stands at about 0.9 M triangles and 100 draw calls today. Downloads: all eight of today's villagers are about 4.2 MB with their animations; aim for under 8 MB for the new cast.

**Checking.** One character at a time in the preview viewer: face from the front, three-quarter and side; whole figure; each clip at several moments. Then in the game at noon, dusk, night with the lantern, and indoors by a hearth, on both renderers (WebGPU and WebGL2). Then `npm test` and `npm run test:e2e`.

## Order of work

1. **Check the setup.** `npm test`, `npm run build`, the game in a browser; computer-use tools present; VRoid Studio open. *Done: Node 26, 74 unit tests pass, the build succeeds, computer use drives VRoid Studio 2.17.0.*
2. **Explore VRoid Studio** before making anything: which sample avatars and presets there are, how to type slider values, how texture layers are exported and imported, what the export screen offers. Replace the guesses in this document with what is found. *Done: see "VRoid Studio as found".*
3. **Pilot character: Wren Tallow.** Make her in VRoid Studio from her sheet, save `art/vroid/herbalist.vroid`, export `art/vroid/herbalist.vrm`. *Checkpoint with the owner.* *Done and approved, with leggings and long hair.*
4. **Pilot in the game**: the build for one `.vrm`, the retargeted clips, then the cel shading and outlines. *Done on the game side (`tools/assets/build-vrm.mjs`, `src/render/celMaterial.ts`); the intermediate checkpoint was waived.*
5. **Life**: blinking, talking, hair and skirt. *Game side; see `docs/DESIGN.md`.*
6. **The other seven**, then the arm, the scarecrows' shading, the names and lines, the credits (`public/assets/CREDITS.md`, `index.html`, `README.md`), the tests, `docs/DESIGN.md`. *All seven made and exported on 27 November; the rest is game-side work. pixiv's two licence pages re-read the same day, unchanged. Checkpoint before merging to `main`.*

## Open questions for the owner

- The proposed names: Orla, Brenna, Dorrie; and the Haywells as sisters.
- Maelin is graceful rather than visibly aged: age her further, or keep her so?
- Aleric's statue: leave as it is?
- Should the `.vroid` source files go into the repository (they are large), or stay on your computer with a backup?
- Wren's satchel: VRoid Studio has no bags. Add one in the game as a prop hung from her hip, or leave it out?
- Wren's shawl became a short hooded cape with a cream trim (the nearest thing the clothing templates give). Good, or should it be more of a draped shawl?
- The permission switches written into each `.vrm` (who may use the avatar, commercial use, redistribution, alteration) are at their most restrictive settings, with the README named for the real terms. They describe what others may do with the raw file, which is not published. Change them?
