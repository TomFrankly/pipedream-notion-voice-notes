import { Groq } from "groq-sdk"
import Instructor from "@instructor-ai/instructor"
import OpenAI from "openai"
import { z } from "zod"

export default defineComponent({
  props: {
    groqcloud: {
      type: "app",
      app: "groqcloud",
    },
    prompt: {
      type: "string",
      label: "Prompt",
      description: "The prompt to send to Groq",
    }
  },
  async run({steps, $}) {
    // Initialize Groq client with API key
    const groq = new Groq({
      apiKey: this.groqcloud.$auth.api_key
    });

    // Initialize OpenAI client (required by Instructor)
    const openai = new OpenAI({
      apiKey: this.groqcloud.$auth.api_key,
      baseURL: "https://api.groq.com/openai/v1"
    });

    // Initialize Instructor with OpenAI client
    const instructor = Instructor({
      client: openai,
      mode: "FUNCTIONS"
    });

    const model = "meta-llama/llama-4-scout-17b-16e-instruct"

    // Define our schema using Zod with refinements
    const StorySchema = z.object({
      story: z.object({
        introduction: z.string()
          .min(10, "Introduction must be at least 10 characters")
          .describe("The opening of the story"),
        body: z.string()
          .min(50, "Body must be at least 50 characters")
          .describe("The main content of the story"),
        conclusion: z.string()
          .min(10, "Conclusion must be at least 10 characters")
          .describe("The ending of the story")
      })
    });

    // 1. Normal text completion with JSON guidance
    const normalCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that always responds with valid JSON. Format your response as a JSON object.

          Example JSON response:
          {
            "story": {
              "introduction": "string",
              "body": "string",
              "conclusion": "string"
            }
          }`
        },
        {
          role: "user",
          content: this.prompt
        }
      ],
      model: model
    });

    // 2. JSON mode enabled
    const jsonModeCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that always responds with valid JSON. Format your response as a JSON object.

          Example JSON response:
          {
            "story": {
              "introduction": "string",
              "body": "string",
              "conclusion": "string"
            }
          }`
        },
        {
          role: "user",
          content: this.prompt
        }
      ],
      model: model,
      response_format: { type: "json_object" }
    });

    // 3. JSON mode with schema validation using Instructor
    const schemaValidationCompletion = await instructor.chat.completions.create({
      model: model,
      response_model: { 
        schema: StorySchema,
        name: "Story"
      },
      messages: [
        {
          role: "user",
          content: this.prompt
        }
      ],
      max_retries: 2
    });

    return {
      normalCompletion: normalCompletion,
      jsonModeCompletion: jsonModeCompletion,
      schemaValidationCompletion: schemaValidationCompletion
    };
  },
})
