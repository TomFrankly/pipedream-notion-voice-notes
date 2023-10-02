# Changelog

## [0.7.0] - 2023-10-02

### Fixed
- Turned off moderation by default, as OpenAI has quietly added strict rate-limiting to the moderation endpoint
- Added instructions on how to disable moderation in moderation error messages
- Added warning message for using Generate Test Event button
- Allow for more supported file types (now supports all [supported Whisper file types](https://platform.openai.com/docs/guides/speech-to-text))
X - Fixed bug with toLowerCase() method in Related Items summary option
- Surface error in case of OpenAI file format rejection about m4a files not working well
- Fixed logs that said "Transcript" but should have said "Summary" or "Translation"
- Run translated transcript through makeParagraphs, which should hopefully solve issues with Notion paragraphs blocks having rich text elements with more than 2,000 characters.

## [0.6.8] - 2023-09-24

### Added
- Initial release