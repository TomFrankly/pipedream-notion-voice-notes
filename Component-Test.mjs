export default {
    name: "Component Test",
    key: "component-test",
    description: "A test component for the Pipedream Notion Voice Notes workflow.",
    type: "action",
    version: "0.0.4",
    props: {
        notion: {
            type: "app",
            app: "notion",
            description: "Connect your Notion account to test the component.",
        },
        test1: {
            type: "string",
            label: "Test 1",
            description: "This is a test property.",
            async options({query, prevContext}) {
                console.log("Query:", query);
                console.log("Previous context:", prevContext);

                return ["Option 1", "Option 2", "Option 3"];
            },
            reloadProps: true,
        },
        steps: {
            type: "object",
            label: "Previous Step Data (Set by Default)",
            description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
        },
        includedSections: {
            type: "string[]",
            label: "Included Sections",
            description: `Choose the sections you'd like to include in your Notion page. A chosen section will only be included if the Transcribe and Summarize step includes data for that section.\n\n**Note:** If you don't include a section here, you can still reference it in your own additional action steps later in the workflow.`,
            options: [
                {
                    label: "Summary",
                    value: "summary",
                },
                {
                    label: "Transcript",
                    value: "transcript",
                },
                {
                    label: "Original-Language Transcript (If Translated)",
                    value: "original_language_transcript",
                },
                {
                    label: "Timestamped Transcript",
                    value: "vtt",
                },
                {
                    label: "Main Points",
                    value: "main_points",
                },
                {
                    label: "Action Items",
                    value: "action_items",
                },
                {
                    label: "Follow-Up Questions",
                    value: "follow_up",
                },
                {
                    label: "Stories",
                    value: "stories",
                },
                {
                    label: "References",
                    value: "references",
                },
                {
                    label: "Arguments",
                    value: "arguments",
                },
                {
                    label: "Jokes",
                    value: "jokes",
                },
                {
                    label: "Related Topics",
                    value: "related_topics",
                },
                {
                    label: "Chapters",
                    value: "chapters",
                }
            ],
        },
    },
    async additionalProps(previousPropDefs) {
        return {
            test2: {
                type: "string",
                label: "Test 2",
                description: "This is a test property.",
            },
        };
    },
    async run({ steps, $ }) {
        return {};
    },
};