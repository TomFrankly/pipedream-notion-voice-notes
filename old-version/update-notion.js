import { Client } from "@notionhq/client"
export default defineComponent({
  props: {
    notion: {
      type: "app",
      app: "notion",
    }
  },
  async run({steps, $}) {

    const notion = new Client({auth: this.notion.$auth.oauth_access_token});

    // Set the page ID
    const pageID = steps.notion.$return_value.response.id.replace(/-/g,'')

    /* --- Send remaining Transcript blocks to the Notion Page --- */
    
    // Push the additional transcript groups to the Notion page
    async function sendTranscripttoNotion (transcript) {
      
      const data = {
        block_id: pageID,
        children: []
      }

      for (let sentence of transcript) {
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

        data.children.push(paragraphBlock)
      }

      const response = await notion.blocks.children.append(data)
      return response
    }

    const transcriptArray = steps.notion.$return_value.transcript
    transcriptArray.shift()
    const transcriptAdditionResponses = []
    for (let transcript of transcriptArray) {
      const response = await sendTranscripttoNotion(transcript)
      transcriptAdditionResponses.push(response)
    }

    /* --- Send the Additional Info to the Notion Page --- */
    
    // Split the additional info array into blocks of 95 blocks max
    const additionalInfo = steps.notion.$return_value.additional_info
    const infoHolder = []
    const infoBlockMaxLength = 95

    for (let i = 0; i < additionalInfo.length; i += infoBlockMaxLength ) {
      const chunk = additionalInfo.slice(i, i + infoBlockMaxLength)
      infoHolder.push(chunk)
    }
    
    // Now send all the additional info to Notion
    async function sendAdditionalInfotoNotion (info) {

      const data = {
        block_id: pageID,
        children: []
      }

      for (let block of info) {
        data.children.push(block)
      }

      const response = await notion.blocks.children.append(data)
      return response

    }

    const additionalInfoAdditionResponses = []
    for (let addition of infoHolder) {
      const response = await sendAdditionalInfotoNotion(addition)
      additionalInfoAdditionResponses.push(response)
    }

    const allAPIResponses = {
      transcript_responses: transcriptAdditionResponses,
      additional_info_responses: additionalInfoAdditionResponses
    }

    return allAPIResponses

  },
})