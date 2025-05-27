# Changelog

## New Actions: Transcribe-Summarize and Send-to-Notion - 2025-05-22

Today, I'm officially releasing two new Pipedream actions that form a complete re-write and upgrade of the Notion Voice Notes workflow.

Previously, a single action – Notion-Voice-Notes – performed the entire process of transcribing the audio file, summarizing the transcript, and creating a new page in Notion.

Now, I've separated the Notion stage into its own step called Send-to-Notion. This brings some major benefits, including the ability to use the Transcribe-Summarize action on its own.

**See the README for the new Pipedream template links, which will automatically create the newest versions of the workflows in your Pipedream account for free.**

Want to support my work? Consider buying my [Ultimate Brain template](https://thomasjfrank.com/brain/) for Notion (which pairs fantastically with this workflow), and/or try out [Flylighter](https://flylighter.com), our advanced Notion web clipper.

Here's an overview of everything that I've added, changed, and fixed:

### Added
- **Multiple speech-to-text services:** Choose from Groq (recommended), Deepgram, AssemblyAI, ElevenLabs, Google Gemini, and OpenAI.
- **Muiltiple LLM services:** Choose from Groq, Anthropic, Google Gemini, OpenAI, and Cerebras.
- **Custom prompts:** In addition to the default Summary lists (Main Points, Action Items, etc), you can now provide a custom prompt to the AI model, which will be run on your entire transcript.
- **Audio file uploads:** Upload your audio file directly to Notion using the Notion API's brand-new file upload capabilities. Embed your audio file directy on your Notion page, or attach it to a Files & Media database property.
- **Wide cloud storage support:** Ability to use *any* cloud storage service supported by Pipedream. The workflow is designed to work with Google Drive, Dropbox, and Microsoft OneDrive out of the box; however, you can provided the file path to any locally-downloaded audio file as well.
- **Custom model support:** This workflow has been tested with several models from each LLM service, but you can optionally provide a string representing a model that isn't included in the default choices. This makes the workflow more future-proof.
- **AI cleanup:** Optionally send your entire transcript through your chosen LLM service to clean up grammar and spelling errors. 
- **Key terms:** If AI cleanup is enabled, you can also provide an array of **key terms**, which can help your transcript have correct spellings of proper names (e.g. [Flylighter](https://flylighter.com)). This feature is also unlocked when using AssemblyAI's Slam-1 speech-to-text model (English-only), which has built-in keyterm support.
- **Timestamp support:** With most speech-to-text services, you'll get an accurate set of captions in VTT format. The Transcribe-Summarize step returns these both as a single string (which you can reference in custom steps) and an array of individual caption lines (which will be used by the Send-to-Notion step to create blocks).
- **Transcript-only mode:** Set the AI Service to "None" if you only want the Transcribe-Summarize action to create a transcript. This setting turns the action into the most flexible, optimized transcription action you'll find for Pipedream.
- **Toggle headings:** Choose which Notion page Heading blocks should be rendered as Toggle Headings.
- **Block compression:** Very long audio files produce *long* transcripts. When packaged into ~3 sentence paragraphs, this can create a huge number of paragraph blocks, which require many Notion API calls to be sent to Notion. This can cause workflows to take a very long time. With *block compression*, paragraphs are turned into Rich Text Objects and fit into as few blocks as possible. This can often result in a >97% reduction in the number of blocks needed for the same amount of text. In one test, this setting reduced required API calls from 97 to just 5. Calls to the Notion API cannot be made concurrently, so this has a *massive* impact on workflow speed.
- **More control:** Enable *Advanced Options* in Transcribe-Summarize to customize the audio file chunk size, disable chunking altogether (for speech-to-text services that support large file uploads), provide a custom path to a file, tweak model temperatures, change summary density, and more. Enable *Give Me More Control* in the Send-to-Notion step to change the section order, header block type, block compression threshold, and more.

### Fixed
- **Speed:** The workflow is now **much** faster, and much more memory-efficient. Timeouts are much less of an issue. I've successfully tested an 8-hour audio file (compressed to around 100mb) using the default 256mb memory setting, and the entire workflow took 90 seconds (totalling only 3 Pipedream credits!)
- **Notion API limitations:** I've integrated my [notion-helper](https://github.com/TomFrankly/notion-helper) library, which seamlessly handles all of the Notion API's limits. The workflow can now handle text payloads of nearly any length as a result.
- **Translation:** Translation has now been fixed, and should be much more reliable.
- **Config errors:** You'll encounter far fewer configuration errors when setting properties (hopefully none). The property configuration steps have been completely rewritten.

### Removed
- **Cost calculations:** Now that this workflow supports many services and well over a dozen models, calculating token costs is not feasible. Fortunately, this doesn't matter! If you select Groq for both speech-to-text and AI services, workflow runs can be free in most cases. If not, the vast majority of model choices will result in far lower costs than in the previous version of this workflow, which used OpenAI's Whisper service (which is now the least recommended option, though still available).

## [0.7.0] - 2023-10-02

### Fixed
- Turned off moderation by default, as OpenAI has quietly added strict rate-limiting to the moderation endpoint
- Added instructions on how to disable moderation in moderation error messages
- Added warning message for using Generate Test Event button
- Allow for more supported file types (now supports all [supported Whisper file types](https://platform.openai.com/docs/guides/speech-to-text))
- Fixed bug with toLowerCase() method in Related Items summary option
- Surface error in case of OpenAI file format rejection about m4a files not working well
- Fixed logs that said "Transcript" but should have said "Summary" or "Translation"
- Run translated transcript through makeParagraphs, which should hopefully solve issues with Notion paragraphs blocks having rich text elements with more than 2,000 characters.

## [0.6.8] - 2023-09-24

### Added
- Initial release