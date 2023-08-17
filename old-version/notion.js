import { Client } from "@notionhq/client"
export default defineComponent({
  props: {
    notion: {
      type: "app",
      app: "notion",
    }
  },
  async run({steps, $}) {

    // Initialize a new Notion client
    const notion = new Client({auth: this.notion.$auth.oauth_access_token});

    // Set the Database ID
    const dbID = process.env.NOTES_DB_ID

    // Current OpenAPI pricing (whisper is per-minute, gpt is per 1k tokens)
    const whisperRate = 0.006
    const gptTurboRate = 0.002

    // Parse Dropbox link so it's clickable
    const mp3Link = encodeURI("https://www.dropbox.com/home" + steps.trigger.event.path_lower);

    // Get the audio duration
    const duration = steps.get_duration.$return_value

    // Get the Date
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const date = `${year}-${month}-${day}`;

    // Build an object with all the content from the Chat API response
    const meta = steps.format_chat.$return_value

    // Add the array of transcript paragraphs
    meta.transcript = steps.make_paragraphs.$return_value.transcript

    // Add the paragraph-separated summary
    meta.long_summary = steps.make_paragraphs.$return_value.summary

    // Add cost values
    const transcriptionCost = Number(((steps.get_duration.$return_value / 60) * whisperRate))
    meta['transcription-cost'] = `Transcription Cost: $${transcriptionCost.toFixed(3).toString()}`
    const chatCost = Number(((steps.format_chat.$return_value.tokens / 1000) * gptTurboRate))
    meta['chat-cost'] = `Chat API Cost: $${chatCost.toFixed(3).toString()}`
    const totalCost = Number((transcriptionCost + chatCost))
    meta['total-cost'] = `Total Cost: $${totalCost.toFixed(3).toString()}`

    // Label the sentiment
    const labeledSentiment = `Sentiment: ${meta.sentiment}`

    // Start building the data object that will be sent to Notion
    const data = {
      "parent": {
        "type": "database_id",
        "database_id": dbID
      },
      "icon": {
        "type": "emoji",
        "emoji": "🤖"
      },
      "properties": {
        "Title": {
          "title": [
            {
              "text": {
                "content": meta.title
              }
            }
          ]
        },
        "Type": {
          "select": {
            "name": "AI Transcription"
          }
        },
        "AI Cost": {
          "number": Math.round(totalCost * 1000) / 1000
        },
        "Duration (Seconds)": {
          "number": duration
        }
      },
      "children": [
        {
          "callout": {
            "rich_text": [
              {
                "text": {
                  "content": "This AI transcription and summary was created on "
                }
              },
              {
                mention: {
                  "type": "date",
                  "date": {
                    "start": date
                  }
                }
              },
              {
                "text": {
                  "content": ". "
                }
              },
              {
                "text": {
                  "content": "Listen to the original recording here.",
                  "link": {
                    "url": mp3Link
                  }
                }
              }
            ],
            "icon": {
              "emoji": "🤖"
            },
            "color": "blue_background"
          }
        },
        {
          "table_of_contents": {
            "color": "default"
          }
        },
        {
          "heading_1": {
            "rich_text": [
              {
                "text": {
                  "content": "Summary"
                }
              }
            ]
          }
        }
      ]
    }

    // Construct the summary
    for (let paragraph of meta.long_summary) {
      const summaryParagraph = {
        "paragraph": {
          "rich_text": [
            {
              "text": {
                "content": paragraph
              }
            }
          ]
        }
      }

      data.children.push(summaryParagraph)
    }

    // Add the Transcript header
    const transcriptHeader = {
      "heading_1": {
        "rich_text": [
          {
            "text": {
              "content": "Transcript"
            }
          }
        ]
      }
    }
    
    data.children.push(transcriptHeader)

    // Create an array of paragraphs from the transcript
    // If the transcript has more than 80 paragraphs, I need to split it and only send
    // the first 80.
    const transcriptHolder = []
    const transcriptBlockMaxLength = 80

    for (let i = 0; i < meta.transcript.length; i += transcriptBlockMaxLength ) {
      const chunk = meta.transcript.slice(i, i + transcriptBlockMaxLength)
      transcriptHolder.push(chunk)
    }


    // Push the first block of transcript chunks into the data object
    const firstTranscriptBlock = transcriptHolder[0]
    console.log(firstTranscriptBlock)
    for (let sentence of firstTranscriptBlock) {
      const paragraphBlock = {
        "paragraph": {
          "rich_text": [
            {
              "text": {
                "content": sentence
              }
            }
          ]
        }
      };
      console.log(sentence)
      data.children.push(paragraphBlock)
    }

    // Add Additional Info

    const additionalInfoArray = []

    const additionalInfoHeader = {
      "heading_1": {
        "rich_text": [
          {
            "text": {
              "content": "Additional Info"
            }
          }
        ]
      }
    }

    additionalInfoArray.push(additionalInfoHeader)

    // Add Action Items

    function additionalInfoHandler (arr, header, itemType) {
      const infoHeader = {
        "heading_2": {
          "rich_text": [
            {
              "text": {
                "content": header
              }
            }
          ]
        }
      }

      additionalInfoArray.push(infoHeader)

      if (header === "Arguments and Areas for Improvement") {
        const argWarning = {
          "callout": {
            "rich_text": [
              {
                "text": {
                  "content": "These are potential arguments and rebuttals that other people may bring up in response to the transcript. Like every other part of this summary document, factual accuracy is not guaranteed."
                }
              }
            ],
            "icon": {
              "emoji": "⚠️"
            },
            "color": "orange_background"
          }
        }
      }

      for (let item of arr) {
        const infoItem = {
          [itemType]: {
            "rich_text": [
              {
                "text": {
                  "content": item
                }
              }
            ]
          }
        }

        additionalInfoArray.push(infoItem)
      }
    }

    additionalInfoHandler(meta.main_points, "Main Points", "bulleted_list_item")
    additionalInfoHandler(meta.stories, "Stories, Examples, and Citations", "bulleted_list_item")
    additionalInfoHandler(meta.action_items, "Potential Action Items", "to_do")
    additionalInfoHandler(meta.follow_up, "Follow-Up Questions", "bulleted_list_item")
    additionalInfoHandler(meta.arguments, "Arguments and Areas for Improvement", "bulleted_list_item")
    additionalInfoHandler(meta.related_topics, "Related Topics", "bulleted_list_item")

    // Add sentiment and cost
    const metaArray = [labeledSentiment, meta['transcription-cost'], meta['chat-cost'], meta['total-cost']]
    additionalInfoHandler(metaArray, "Meta", "bulleted_list_item")

    // Create the page in Notion
    const response = await notion.pages.create( data )

    // Create an object to pass to the next step
    const responseHolder = {
      response: response,
      transcript: transcriptHolder,
      additional_info: additionalInfoArray
    }

    return responseHolder


  },
})