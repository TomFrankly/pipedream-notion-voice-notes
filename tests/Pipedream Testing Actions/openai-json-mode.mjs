import OpenAI from "openai"
import Instructor from "@instructor-ai/instructor"
import { z } from "zod"

export default defineComponent({
  props: {
    openai: {
      type: "app",
      app: "openai",
    },
    prompt: {
      type: "string",
      label: "Prompt",
      description: "The prompt to send to OpenAI",
    }
  },
  async run({steps, $}) {
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: this.openai.$auth.api_key
    });

    // Initialize Instructor with OpenAI client
    const instructor = Instructor({
      client: openai,
      mode: "FUNCTIONS"
    });

    const model = "gpt-4.1-mini"

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

    // Convert Zod schema to JSON Schema for OpenAI
    const jsonSchema = {
      name: "Story",
      type: "object",
      properties: {
        story: {
          type: "object",
          properties: {
            introduction: {
              type: "string",
              description: "The opening of the story",
              minLength: 10
            },
            body: {
              type: "string",
              description: "The main content of the story",
              minLength: 50
            },
            conclusion: {
              type: "string",
              description: "The ending of the story",
              minLength: 10
            }
          },
          required: ["introduction", "body", "conclusion"],
          additionalProperties: false
        }
      },
      required: ["story"],
      additionalProperties: false
    };

    // 1. Normal text completion with JSON guidance
    const normalCompletion = await openai.chat.completions.create({
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

    // 2. JSON mode enabled (using older json_object format)
    const jsonModeCompletion = await openai.chat.completions.create({
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

    return {
      normalCompletion: normalCompletion,
      jsonModeCompletion: jsonModeCompletion,
    };
  },
})
