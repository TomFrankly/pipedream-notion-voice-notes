import natural from "natural"; // Sentence tokenization
import { franc, francAll } from "franc"; // Language detection
import { encode, decode } from "gpt-3-encoder"; // GPT-3 encoder for ChatGPT-specific tokenization

export default {
    methods: {
        /**
         * Combines transcript chunks from various transcription services into a single coherent text
         * @param {Array} chunksArray - Array of transcript chunks from any supported service
         * @returns {string} Combined transcript text
         */
        async combineTranscriptChunks(chunksArray) {
            console.log(`Combining ${chunksArray.length} transcript chunks into a single transcript...`);

            try {
                let combinedText = "";

                for (let i = 0; i < chunksArray.length; i++) {
                    const currentChunk = chunksArray[i];
                    const nextChunk = i < chunksArray.length - 1 ? chunksArray[i + 1] : null;

                    // Extract text based on service type
                    let currentText = this.extractTextFromChunk(currentChunk);
                    let nextText = nextChunk ? this.extractTextFromChunk(nextChunk) : null;

                    // Handle sentence boundaries
                    if (nextText && this.endsWithSentence(currentText) && this.startsWithLowerCase(nextText)) {
                        currentText = currentText.slice(0, -1);
                    }

                    // Add space between chunks if not the last chunk
                    if (i < chunksArray.length - 1) {
                        currentText += " ";
                    }

                    combinedText += currentText;
                }

                console.log("Transcript combined successfully.");
                return combinedText.trim();
            } catch (error) {
                throw new Error(`An error occurred while combining the transcript chunks: ${error.message}`);
            }
        },

        /**
         * Extracts text from a chunk based on the service type
         * @param {Object} chunk - Transcript chunk from any supported service
         * @returns {string} Extracted text
         */
        extractTextFromChunk(chunk) {
            if (!chunk) {
                console.warn("Received null or undefined chunk");
                return "";
            }

            // Handle OpenAI/Groq response
            if (chunk.text) {
                return chunk.text;
            }

            // Handle Deepgram response
            if (chunk.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
                return chunk.results.channels[0].alternatives[0].transcript;
            }

            // If no text found, log the chunk structure for debugging
            console.warn("No text found in chunk. Chunk structure:", JSON.stringify(chunk, null, 2));
            return "";
        },

        /**
         * Checks if a string ends with a sentence-ending punctuation
         * @param {string} text - Text to check
         * @returns {boolean} Whether the text ends with a sentence
         */
        endsWithSentence(text) {
            return /[.!?]$/.test(text.trim());
        },

        /**
         * Checks if a string starts with a lowercase letter
         * @param {string} text - Text to check
         * @returns {boolean} Whether the text starts with lowercase
         */
        startsWithLowerCase(text) {
            return text.length > 0 && text[0] === text[0].toLowerCase();
        },
        findLongestPeriodGap(text, maxTokens) {
			let lastPeriodIndex = -1;
			let longestGap = 0;
			let longestGapText = "";

			for (let i = 0; i < text.length; i++) {
				if (text[i] === ".") {
					if (lastPeriodIndex === -1) {
						lastPeriodIndex = i;
						continue;
					}

					let gap = i - lastPeriodIndex - 1;
					let gapText = text.substring(lastPeriodIndex + 1, i);

					if (gap > longestGap) {
						longestGap = gap;
						longestGapText = gapText;
					}

					lastPeriodIndex = i;
				}
			}

			if (lastPeriodIndex === -1) {
				return { longestGap: -1, longestGapText: "No period found" };
			} else {
				const encodedLongestGapText = encode(longestGapText);
				return {
					longestGap,
					longestGapText,
					maxTokens,
					encodedGapLength: encodedLongestGapText.length,
				};
			}
		},

        /**
         * Combines VTT objects from transcript chunks into a single coherent VTT file
         * @param {Array} chunksArray - Array of transcript chunks containing VTT data
         * @returns {string} Combined VTT content
         */
        async combineVTTChunks(chunksArray) {
            console.log(`Combining ${chunksArray.length} VTT/SRT chunks...`);

            try {
                let combinedVTT = "WEBVTT\n\n";
                let currentSegmentNumber = 1;
                let lastEndTime = 0;

                for (let i = 0; i < chunksArray.length; i++) {
                    const chunk = chunksArray[i];
                    
                    // Get content from either VTT or SRT format
                    let content = null;
                    if (chunk.vtt) {
                        content = chunk.vtt;
                    } else if (chunk.additional_formats) {
                        const srtFormat = chunk.additional_formats.find(format => 
                            format.requested_format === 'srt' && format.content
                        );
                        if (srtFormat) {
                            content = srtFormat.content;
                        }
                    }
                    
                    if (!content) continue;

                    // Split content into lines and process
                    const lines = content.split('\n');
                    let inMetadata = false;
                    let currentSegment = [];
                    let timeOffset = i === 0 ? 0 : lastEndTime;

                    for (let line of lines) {
                        line = line.trim();
                        if (!line) continue;

                        // Skip WEBVTT header and metadata
                        if (line === 'WEBVTT' || line === 'SRT') {
                            inMetadata = true;
                            continue;
                        }
                        if (inMetadata) {
                            // Skip metadata lines (they start with NOTE or contain timestamps)
                            if (line.startsWith('NOTE') || line.includes('-->')) {
                                inMetadata = false;
                            } else {
                                continue;
                            }
                        }

                        // Check if this is a segment number line
                        if (/^\d+$/.test(line)) {
                            if (currentSegment.length > 0) {
                                // Process previous segment
                                const processedSegment = this.processVTTSegment(currentSegment, currentSegmentNumber, timeOffset);
                                if (processedSegment) {
                                    combinedVTT += processedSegment + '\n\n';
                                    currentSegmentNumber++;
                                }
                            }
                            currentSegment = [];
                            continue;
                        }

                        // Check if this is a timestamp line
                        if (line.includes('-->')) {
                            const [start, end] = line.split('-->').map(t => t.trim());
                            // Convert SRT timestamp format (comma) to VTT format (dot) if needed
                            const endTime = this.parseVTTTime(end.replace(',', '.'));
                            if (endTime > lastEndTime) {
                                lastEndTime = endTime;
                            }
                            currentSegment.push(line);
                            continue;
                        }

                        // Clean up speaker labels and add text
                        line = line.replace(/<v\s+Speaker\s+(\d+)>/g, 'Speaker $1: ').trim();
                        if (line) {
                            currentSegment.push(line);
                        }
                    }

                    // Process the last segment in the chunk
                    if (currentSegment.length > 0) {
                        const processedSegment = this.processVTTSegment(currentSegment, currentSegmentNumber, timeOffset);
                        if (processedSegment) {
                            combinedVTT += processedSegment + '\n\n';
                            currentSegmentNumber++;
                        }
                    }
                }

                return combinedVTT.trim();
            } catch (error) {
                throw new Error(`An error occurred while combining VTT/SRT chunks: ${error.message}`);
            }
        },

        /**
         * Processes a single VTT segment and adjusts its timestamps
         * @param {Array} segment - Array of lines in the segment
         * @param {number} segmentNumber - New segment number
         * @param {number} timeOffset - Time offset to add to timestamps
         * @returns {string} Processed segment
         */
        processVTTSegment(segment, segmentNumber, timeOffset) {
            if (segment.length < 2) return null;

            const result = [`${segmentNumber}`];
            
            // Process timestamp line
            const timestampLine = segment[0];
            if (timestampLine.includes('-->')) {
                const [start, end] = timestampLine.split('-->').map(t => t.trim());
                const newStart = this.adjustVTTTime(start, timeOffset);
                const newEnd = this.adjustVTTTime(end, timeOffset);
                result.push(`${newStart} --> ${newEnd}`);
            }

            // Add remaining lines (the actual text) and clean up any remaining speaker labels
            const textLines = segment.slice(1).map(line => 
                line.replace(/<v\s+Speaker\s+(\d+)>/g, 'Speaker $1:').trim()
            ).filter(line => line);
            
            result.push(...textLines);
            
            return result.join('\n');
        },

        /**
         * Adjusts a VTT timestamp by adding an offset
         * @param {string} time - VTT timestamp (HH:MM:SS.mmm)
         * @param {number} offset - Time offset in milliseconds
         * @returns {string} Adjusted timestamp
         */
        adjustVTTTime(time, offset) {
            const totalMs = this.parseVTTTime(time) + offset;
            return this.formatVTTTime(totalMs);
        },

        /**
         * Parses a VTT timestamp into milliseconds
         * @param {string} time - VTT timestamp (HH:MM:SS.mmm)
         * @returns {number} Time in milliseconds
         */
        parseVTTTime(time) {
            const [hours, minutes, seconds] = time.split(':').map(Number);
            return (hours * 3600 + minutes * 60 + seconds) * 1000;
        },

        /**
         * Formats milliseconds into a VTT timestamp
         * @param {number} ms - Time in milliseconds
         * @returns {string} Formatted VTT timestamp
         */
        formatVTTTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            const milliseconds = Math.floor(ms % 1000);

            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
        }
    }
};
