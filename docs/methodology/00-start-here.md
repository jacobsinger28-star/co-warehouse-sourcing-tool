# Start Here: The Off-Market Operating System

**By:** NextAutomation, nextautomation.us
**Version:** 1.0 (June 2026)

This is a guide and a drop-in Claude kit. By the end of one session you will
have a Claude Project that reads public records and hands you a filtered list of
private off-market owners in your county, ranked by how likely they are to sell.
Any asset class: multifamily, retail, industrial, land, mixed-use, manufactured
housing. Same system, you just swap the filters.

If the existing "Off-Market Sourcing Agent" pack is the blueprint for the
production agent we run, this one is the version you run yourself, today, by hand,
with no code.

---

## The 15-minute version

1. Open Claude (claude.ai) and create a new Project. A Project keeps your
   instructions and files in one place so every chat in it behaves the same way.
2. Open `01-claude-project-setup.md`. Copy the whole system prompt into the
   Project's custom instructions. That is the operating system. It turns a blank
   Claude into a disciplined sourcing analyst that never silently drops a row and
   never names an owner without an evidence chain.
3. Open `02-deal-box-template.md`, fill it in for the asset class and county you
   want to work, and add it to the Project as a file. This is your mandate.
4. Pull one free input: a parcel or owner export from your county assessor or GIS
   open-data portal for one submarket. Start a chat and paste it in.
5. Run the four stages from `03-the-four-stage-engine.md` in order. You will end
   the session with a filtered, ranked list of private owners for that submarket,
   resolved as far as the records you pull allow. The more public data you feed
   the scoring and resolution stages, the deeper the list goes.

That is the whole loop. Everything else in this kit makes each stage sharper.

---

## How a Claude Project works (60-second primer)

A Claude Project is a workspace with three parts:

- **Custom instructions** that apply to every chat inside it. This is where the
  system prompt from file 01 lives.
- **Project files** that every chat can read. Put your filled deal box and any
  trusted comps here.
- **Chats**, one per submarket or per run, all sharing the instructions and files
  above.

You do not need to be technical. You paste two things in once, then you have
working conversations. If you have used a custom GPT or any chat assistant, you
already know how to do this.

---

## What you provide

- **A filled deal box** (file 02): asset type, size, geography, owner profile,
  hard no's. Fill it once per mandate.
- **One data pull per stage.** In this by-hand mode you fetch the public record
  yourself and paste it in. File 05 maps exactly where each pull comes from and
  which ones are free.
- **A contact-enrichment provider** for the final reach stage, if you want
  verified phone and email. Claude does not invent contact details. It resolves
  the human from public records and tells you who to enrich; the verified number
  comes from your own provider, not from Claude.

---

## Honest expectations

- **Your first run is an afternoon, not 38 minutes.** The 38-minute number is the
  production agent in agent mode, with the data feeds already wired. By hand, the
  pulling between stages is the slow part. You will still finish a submarket in a
  day that would take an analyst two to three weeks.
- **This is the build, not a magic button.** The kit gives you the method, the
  prompts, and the templates. You run it on your own data and you own the
  pipeline that comes out the other side.
- **A human reads everything before it goes out.** The system is designed around a
  review gate, not in spite of one. Skipping it is how a wrong-owner letter goes
  out with your name on it.

Start with `01-claude-project-setup.md`, then fill `02-deal-box-template.md`.

---

*Built by NextAutomation. We design and deploy AI systems for real estate
investors, brokers, and developers. nextautomation.us*
