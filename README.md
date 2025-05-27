This is a powerful (and free) speech-to-text workflow for [Pipedream](https://thomasjfrank.com/pipedream/). It is designed to help you take notes in [Notion](https://thomasjfrank.com/usenotion/) with your voice; however, it can also be used for other purposes.

It allows you to:

- Upload audio files to Google Drive, Dropbox, Microsoft OneDrive, and other cloud services
- Transcribe the audio to text (see supported providers below)
- Translate the text to other languages
- Summarize the transcript (see supported AI services below)
- Extract main points, action items, references, stories, etc.
- Get timestamps (captions)
- Send everything to Notion

To use it, simply set up and deploy the workflow in Pipedream using the one-click links in the section below, then upload audio files to your configured cloud storage folder.

**[Check out the full tutorial and FAQ here for more details.](https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/)**

## Versions

This is a one-click Pipedream workflow. Choose the version that works with your chosen cloud storage provider.

* [Dropbox Version](https://thomasjfrank.com/pipedream-notion-voice-notes-dropbox/)
* [Google Drive Version](https://thomasjfrank.com/pipedream-notion-voice-notes-gdrive/)
* [Microsoft OneDrive Version](https://thomasjfrank.com/pipedream-notion-voice-notes-onedrive/)

***Advanced:** If you have some other way of uploading audio files to Pipedream, you can also provide the direct path to a locally-downloaded file.*

## Compatibility

This workflow will work with any Notion database.

### Upgrade Your Notion Experience

While this workflow will work with any Notion database, it’s even better with a template.

For general productivity use, you’ll love [Ultimate Brain](https://thomasjfrank.com/brain/) – my all-in-one second brain template for Notion. 

Ultimate Brain brings tasks, notes, projects, and goals all into one tool. Naturally, it works very well with this workflow.

**Are you a creator?**

My [Creator’s Companion](https://thomasjfrank.com/creators-companion/) template includes a ton of features that will help you make better-performing content and optimize your production process. There’s even a version that includes Ultimate Brain, so you can easily use this workflow to create notes whenever you have an idea for a new video or piece of content.

## Instructions

[Click here for the full instructions on setting up this workflow.](https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/)

## Supported Providers

This workflow provides support for several speech-to-text and LLM providers. Some provide free usage tiers, which means this entire workflow can be run for free within certain limits.

**Speech to Text:**

For speech to text, Groq is generally recommended. They allow up to 8 hours of free transcription per day, and their models are extremely fast.

- Groq (free tier available)
- Deepgram
- AssemblyAI
- ElevenLabs
- Google Gemini (free tier available)
- OpenAI

**AI (LLMs):**

For AI (summarization, translation, AI cleanup), Groq is generally recommended for most use cases. Their open-source Llama models have a generous free tier, are extremely fast, and are adequate for this workflow's main use cases.

If you want to run more complex prompts on your transcript, you can also use higher-powered models from Anthropic, Google, or OpenAI.

- Groq (free tier available)
- Anthropic
- Google Gemini (free tier available)
- OpenAI
- Cerebras (free tier available)

For each service, a handful of tested models are provided as default options. There is also a **Custom AI Model** option you can access by enabling Advanced Settings, which is useful if you want to specify another model.

## Going Beyond Notion

This workflow features two custom Pipedream actions:

1. **Transcribe-Summarize:** This step sends your audio file to your chosen speech-to-text services. It also handles translation, AI cleanup, and AI summarization as configured.
2. **Send-to-Notion:** This custom action sends everything from the Transcribe-Summarize step to a new page in Notion. It uses my [notion-helper](https://github.com/TomFrankly/notion-helper) library to minimize API calls and handle the Notion API's various limitations.

The Transcribe-Summarize step returns everything you could want for repurposing this workflow for use with other apps.

Want to email the transcript instead, or send it to Slack? No sweat. Just remove/disable the Send-to-Notion step and bring in your own custom steps that references the exports from Transcribe-Summarize.

## More Resources

**More automations you may find useful:**

* [Create Tasks in Notion with Your Voice](https://thomasjfrank.com/notion-chatgpt-voice-tasks/)

**All My Notion Automations:**

* [Notion Automations Hub](https://thomasjfrank.com/notion-automations/)

**Want to get notified about updates to this workflow (and about new Notion templates, automations, and tutorials)?**

* [Join my Notion Tips newsletter](https://thomasjfrank.com/fundamentals/#get-the-newsletter)

## Support My Work

This workflow is **100% free** – and it gets updates and improvements! *When there's an update, you'll see an **update** button in the top-right corner of this step.*

If you want to support my work, the best way to do so is buying one of my premium Notion Templates:

* [Ultimate Brain](https://thomasjfrank.com/brain/) – the ultimate second-brain template for Notion
* [Creator's Companion](https://thomasjfrank.com/creators-companion/) – my advanced template for serious content creators looking to publish better content more frequently

Beyond that, sharing this automation's YouTube tutorial online or with friends is also helpful!

## Copyright

*I've made the code for this workflow public, so you can study it, use it as a learning tool, or modify it for **private, personal use**. Redistributing it, modified or unmodified, for free or paid, is not permitted.*