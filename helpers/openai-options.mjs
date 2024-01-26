import lang from "./languages.mjs";

export default {
    props: {
        temperature: {
            type: "integer",
            label: "Model Temperature",
            description: `Set the temperature for the model. Valid values are integers between 0 and 20 (inclusive), which are divided by 10 to achieve a final value between 0 and 2.0. Higher temperatures may result in more "creative" output, but have the potential to cause the output to fail to be valid JSON. This workflow defaults to 0.2.`,
            optional: true,
            min: 0,
            max: 20,
        },
        verbosity: {
            type: "string",
            label: "Summary Verbosity (Advanced)",
            description: `Sets the verbosity of your summary and lists (whichever you've activated) **per transcript chunk**. Defaults to **Medium**.\n\nHere's what each setting does:\n\n* **High** - Summary will be 20-25% of the transcript length. Most lists will be limited to 5 items.\n* **Medium** - Summary will be 10-15% of the transcript length. Most lists will be limited to 3 items.\n* **Low** - Summary will be 5-10% of the transcript length. Most lists will be limited to 2 items.\n\nNote that these numbers apply *per transcript chunk*, as the instructions have to be sent with each chunk.\n\nThis means you'll have even more control over verbosity if you set the **Summary Density** option to a lower number.`,
            default: "Medium",
            options: ["High", "Medium", "Low"],
            optional: true,
        },
        chunk_size: {
            type: "integer",
            label: "Audio File Chunk Size",
            description: `Your audio file will be split into chunks before being sent to Whisper for transcription. This is done to handle Whisper's 24mb max file size limit.\n\nThis setting will let you make those chunks even smaller – anywhere between 8mb and 24mb.\n\nSince the workflow makes concurrent requests to Whisper, a smaller chunk size may allow this workflow to handle longer files.\n\nSome things to note with this setting: \n\n* Chunks will default to 24mb if you don't set a value here. I've successfully transcribed a 2-hour file at this default setting by changing my workflow's timeout limit to 300 seconds, which is possible on the free plan. \n* If you're currently using trial credit with OpenAI and haven't added your billing information, your [Audio rate limit](https://platform.openai.com/docs/guides/rate-limits/what-are-the-rate-limits-for-our-api) will likely be 3 requests per minute – meaning setting a smaller chunk size may cause you to hit that rate limit. You can fix this by adding your billing info and generating a new API key. \n* Longer files may also benefit from your workflow having a higher RAM setting. \n* There will still be limits to how long of a file you can transcribe, as the max workflow timeout setting you can choose on Pipedream's free plan is 5 minutes. If you upgrade to a paid account, you can go as high as 12 minutes.`,
            optional: true,
            min: 8,
            max: 24,
            default: 24,
        },
        disable_moderation_check: {
            type: "boolean",
            label: "Disable Moderation Check",
            description: `By default, this workflow will **not** check your transcript for inappropriate content using OpenAI's Moderation API. If you'd like to enable this check, set this option to **false**.\n\nThis option may be subject to low rate limits within your OpenAI account, which is why it is disabled by default. You can check your current rate limits by visiting your account's [rate limits page](https://platform.openai.com/account/rate-limits) and checking the limit for the **text-moderation-stable** endpoint.`,
            optional: true,
            default: true,
        },
        whisper_prompt: {
            type: "string",
            label: "Whisper Prompt (Optional)",
            description: `You can enter a prompt here to help guide the transcription model's style. By default, the prompt will be "Hello, welcome to my lecture." which is a default prompt provided by OpenAI to help improve with punctuation. Learn more: https://platform.openai.com/docs/guides/speech-to-text/prompting`,
            optional: true,
        },
        fail_on_no_duration: {
            type: "boolean",
            label: "Fail on No Duration",
            description: "If this automation fails to calculate the duration of the audio file, it will also be unable to calculate the cost of the run. Set this to **true** if you would like the workflow to throw an error and end in this case. If this option is set to **false**, the workflow will continue and set duration to zero.\n\nTypically, duration calculation failures happen when certain voice recorder apps create audio files that can't be read by this automation's duration-calculation function (the music-metadata npm package). The only solution is to try a different voice recorder app.",
            default: false,
            optional: true
        }
    }
}