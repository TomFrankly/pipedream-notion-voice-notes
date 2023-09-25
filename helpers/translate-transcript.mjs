import Bottleneck from "bottleneck";
import retry from "async-retry";
import common from "./common.mjs";
import lang from "./languages.mjs";

export default {
    props: {
        transcript_language: {
            type: "string",
            label: "Transcript Language (Optional)",
            description: `Select your preferred output language. Whisper will attempt to translate the audio into it.\n\nIf you don't know the language of your file, you can leave this blank, and Whisper will attempt to detect the language and write the transcript in the same language.\n\nThis option only supports the [Whisper model's supported languages](https://help.openai.com/en/articles/7031512-whisper-api-faq).\n\n**Note:** If you want both the original-language transcript as well as a translated one, leave this option **blank**, then set Summary Language and Add Translation in the Advanced Settings below.`,
            optional: true,
            options: lang.LANGUAGES.map((lang) => ({
                label: lang.label,
                value: lang.value,
            })),
            reloadProps: true,
        },
        summary_language: {
            type: "string",
            label: "Summary Language (Advanced)",
            description: `Specify a language for the summary content. This will tell ChatGPT to attempt to summarize the transcript in your selected language.\n\nIf you leave this blank, ChatGPT will be instructed to use the same language as the transcript.\n\nThis option only supports the [Whisper model's supported languages](https://help.openai.com/en/articles/7031512-whisper-api-faq).`,
            optional: true,
            options: lang.LANGUAGES.map((lang) => ({
                label: lang.label,
                value: lang.value,
            })),
            reloadProps: true,
        },
        translate_transcript: {
            type: "string",
            label: "Add Translation (Transcript)",
            description: `Choose an option below if you want to have ChatGPT translate the transcript into your chosen Summary Language. This will only happen if the transcript's language differs from the Summary Language setting.\n\n**Note:** This will increase the cost of the run by approx. $0.003 per 1,000 words. This option *always* uses the default gpt-3.5-turbo model. This option will also increase the time each run takes, reducing the maximum audio file length that can be handled with your workflow's current timeout settings.\n\nIf you leave this blank or set it to "Don't Translate", your selected Summary Language will still be used for your chosen Summary Options.\n\nEach option explained:\n\n* **Translate and Keep Original** - ChatGPT will translate the transcript into your chosen Summary Language, and this script will also include the original-language transcript in the summary.\n* **Translate Only** - ChatGPT will translate the transcript into your chosen Summary Language, but will not include the original transcript in the summary.\n* **Don't Translate** - ChatGPT will not translate the transcript, and will only include the original transcript in the summary.`,
            optional: true,
            options: [
                "Translate and Keep Original",
                "Translate Only",
                "Don't Translate",
            ],
        },
    },
	methods: {
		...common.methods,
        async detectLanguage(text, openai, chat_model) {
			return retry(
				async (bail, attempt) => {
					console.log(
						`Attempt ${attempt}: Detecting transcript language using ChatGPT`
					);
					const response = await openai.chat.completions.create(
						{
							model: chat_model ?? "gpt-3.5-turbo",
							messages: [
								{
									role: "user",
									content: text,
								},
								{
									role: "system",
									content: `Detect the language of the prompt, then return a valid JSON object containing the language name and language code of the text.
                                    
                                    Example: {\"label\": \"English\", \"value\": \"en\"}`,
								},
							],
							temperature: 0,
						},
						{
							maxRetries: 3,
						}
					);

					console.log(`Language detected successfully.`);
					return response;
				},
				{
					retries: 3,
					onRetry: (error, attempt) => {
						console.error(
							`Attempt ${attempt} for language detection failed with error: ${error.message}. Retrying...`
						);
					},
				}
			);
		},
		async formatDetectedLanguage(text) {
			console.log(`Formatting the detected language result...`);
            try {
                const formattedDetectedLanguage = this.repairJSON(text)
			
                console.log(`Formatted the detected language result successfully.`);
                return formattedDetectedLanguage;
            } catch (error) {
                throw new Error(`Formatting the detected language result failed with error: ${error.message}`);
            }
		},
        async translateParagraphs(openai, stringsArray, language) {
            try {
				const limiter = new Bottleneck({
					maxConcurrent: 100,
				});

				console.log(`Sending ${stringsArray.length} paragraphs to ChatGPT for translation...`);
				const results = await limiter.schedule(() => {
					const tasks = stringsArray.map((arr, index) =>
						this.translate(openai, arr, index, language)
					);
					return Promise.all(tasks);
				});
				
                const translationResult = {
                    paragraphs: results.map((result) => result.choices[0].message.content),
                    language: language.label,
                    languageCode: language.value,
                    usage: {
                        prompt_tokens: results.reduce((total, item) => total + item.usage.prompt_tokens, 0),
                        completion_tokens: results.reduce((total, item) => total + item.usage.completion_tokens, 0),
                    },
                    model: results[0].model,
                }

                console.log(`Translated ${stringsArray.length} paragraphs successfully.`);
                return translationResult;
			} catch (error) {
				console.error(error);

				throw new Error(
					`An error occurred while translating the transcript with ChatGPT: ${error.message}`
				);
			}
        },
        async translate(openai, prompt, index, language) {
			return retry(
				async (bail, attempt) => {
					console.log(`Attempt ${attempt}: Sending paragraph ${index} to ChatGPT for translation...`);
					const response = await openai.chat.completions.create(
						{
							model: "gpt-3.5-turbo",
							messages: [
								{
									role: "user",
									content: prompt,
								},
								{
									role: "system",
									content: `Translate the text into ${language.label} (ISO 639-1 code: ${language.value}).`,
								},
							],
							temperature: 0,
						},
						{
							maxRetries: 3,
						}
					);

					console.log(`Paragraph ${index} received successfully.`);
					return response;
				},
				{
					retries: 3,
					onRetry: (error, attempt) => {
						console.error(
							`Attempt ${attempt} for translation of paragraph ${index} failed with error: ${error.message}. Retrying...`
						);
					},
				}
			);
		}
	},
};
