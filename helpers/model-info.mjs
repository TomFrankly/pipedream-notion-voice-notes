/**
 * This file in intended to include the latest pricing rates from OpenAI and Deepgram, list the context window and output limits for OpenAI models, and be a definitive list of available models for all workflows.
 */

const MODEL_INFO = {
	openai: {
		text: {
			"gpt-4-0125-preview": {
				prompt: 0.01,
				completion: 0.03,
				window: 128000,
				output: 4096,
				json: true,
			},
			"gpt-4-turbo-preview": {
				prompt: 0.01,
				completion: 0.03,
				window: 128000,
				output: 4096,
				json: true,
			},
			"gpt-4-1106-preview": {
				prompt: 0.01,
				completion: 0.03,
				window: 128000,
				output: 4096,
				json: false,
			},
			"gpt-4": {
				prompt: 0.03,
				completion: 0.06,
				window: 8192,
				output: 4096,
				json: false,
			},
			"gpt-4-32k": {
				prompt: 0.06,
				completion: 0.12,
				window: 32768,
				output: 4096,
				json: false,
			},
			"gpt-3.5-turbo-0125": {
				prompt: 0.0005,
				completion: 0.0015,
				window: 16385,
				output: 4096,
				json: true,
			},
			"gpt-3.5-turbo-1106": {
				prompt: 0.001,
				completion: 0.002,
				window: 16385,
				output: 4096,
				json: false,
			},
			"gpt-3.5-turbo": {
				prompt: 0.0005,
				completion: 0.0015,
				window: 16385,
				output: 4096,
				json: true,
			},
		},
		audio: {
			whisper: {
				large: {
					completion: 0.006, // $0.006 per minute
				},
			},
		},
	},
	anthropic: {
		text: {
			"claude-3-opus-20240229": {
				prompt: 0.015,
				completion: 0.075,
				window: 200000,
				output: 4096,
			},
			"claude-3-sonnet-20240229": {
				prompt: 0.003,
				completion: 0.015,
				window: 200000,
				output: 4096,
			},
			"claude-3-haiku-20240307": {
				prompt: 0.00025,
				completion: 0.00125,
				window: 200000,
				output: 4096,
			},
		},
	},
	deepgram: {
		audio: {
			"nova-2": {
				default: {
					"pay-as-you-go": 0.0043, // $0.0043 per minute
					growth: 0.0036, // $0.0036 per minute
				},
			},
			"nova-1": {
				default: {
					"pay-as-you-go": 0.0043, // $0.0043 per minute
					growth: 0.0036, // $0.0036 per minute
				},
			},
			enhanced: {
				default: {
					"pay-as-you-go": 0.0145, // $0.0145 per minute
					growth: 0.0115, // $0.0115 per minute
				},
			},
			base: {
				default: {
					"pay-as-you-go": 0.0125, // $0.0125 per minute
					growth: 0.0095, // $0.0095 per minute
				},
			},
			whisper: {
				large: {
					"pay-as-you-go": 0.0048, // $0.0048 per minute
					growth: 0.0048, // $0.0048 per minute
					concurrency: {
						"pay-as-you-go": 5, // 5 concurrent requests
						growth: 15, // 15 concurrent requests
					},
				},
				medium: {
					"pay-as-you-go": 0.0042, // $0.0042 per minute
					growth: 0.0035, // $0.0035 per minute
					concurrency: {
						"pay-as-you-go": 5, // 5 concurrent requests
						growth: 15, // 15 concurrent requests
					},
				},
				small: {
					"pay-as-you-go": 0.0038, // $0.0038 per minute
					growth: 0.0032, // $0.0032 per minute
					concurrency: {
						"pay-as-you-go": 5, // 5 concurrent requests
						growth: 15, // 15 concurrent requests
					},
				},
				tiny: {
					"pay-as-you-go": 0.0033, // $0.0033 per minute
					growth: 0.0027, // $0.0027 per minute
					concurrency: {
						"pay-as-you-go": 5, // 5 concurrent requests
						growth: 15, // 15 concurrent requests
					},
				},
				base: {
					"pay-as-you-go": 0.0035, // $0.0035 per minute
					growth: 0.0028, // $0.0028 per minute
					concurrency: {
						"pay-as-you-go": 5, // 5 concurrent requests
						growth: 15, // 15 concurrent requests
					},
				},
			},
		},
	},
};

export default MODEL_INFO;
