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

        /**
         * Combines VTT objects from transcript chunks into a single coherent VTT file
         * @param {Array} chunksArray - Array of transcript chunks containing VTT data
         * @returns {string} Combined VTT content
         */
        async combineVTTChunks(chunksArray) {
            console.log(`Combining ${chunksArray.length} VTT/SRT chunks...`);

            try {
                let combinedVTT = "";
                let allSegments = [];

                // Helper to detect timestamp lines
                const isTimestampLine = (line) => /\d{2}:\d{2}:\d{2}[.,]\d{3}\s*--\>\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(line);

                for (let i = 0; i < chunksArray.length; i++) {
                    const chunk = chunksArray[i];
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

                    // Split into lines and preprocess
                    const lines = content.split('\n');
                    let inNoteOrMetadata = false;
                    let foundFirstTimestamp = false;
                    let currentSegment = [];
                    let segments = [];

                    for (let idx = 0; idx < lines.length; idx++) {
                        let line = lines[idx].trim();
                        if (!line) continue;

                        // Skip WEBVTT or SRT header
                        if (line === 'WEBVTT' || line === 'SRT') continue;

                        // Skip NOTE and metadata until first timestamp
                        if (!foundFirstTimestamp) {
                            if (line.startsWith('NOTE')) {
                                inNoteOrMetadata = true;
                                continue;
                            }
                            if (inNoteOrMetadata) {
                                // End NOTE block at first blank line or timestamp
                                if (isTimestampLine(line)) {
                                    inNoteOrMetadata = false;
                                    foundFirstTimestamp = true;
                                } else {
                                    continue;
                                }
                            } else if (isTimestampLine(line)) {
                                foundFirstTimestamp = true;
                            } else {
                                // Skip all lines before first timestamp
                                continue;
                            }
                        }

                        // Remove segment numbers (lines that are just a number)
                        if (/^\d+$/.test(line)) continue;

                        // Start of a new segment
                        if (isTimestampLine(line)) {
                            // Convert SRT-style commas to VTT-style periods for VTT output
                            line = line.replace(/,/g, '.');
                            if (currentSegment.length > 0) {
                                segments.push([...currentSegment]);
                                currentSegment = [];
                            }
                        }
                        // Fix speaker label: <v Speaker 0> -> Speaker 0: 
                        line = line.replace(/^<v\s+Speaker\s+(\d+)>/gi, 'Speaker $1: ');
                        currentSegment.push(line);
                    }
                    // Push last segment
                    if (currentSegment.length > 0) {
                        segments.push([...currentSegment]);
                    }
                    // Add to allSegments
                    allSegments.push(...segments);
                }

                // Renumber and format all segments
                let segmentNumber = 1;
                for (const segment of allSegments) {
                    if (segment.length === 0) continue;
                    combinedVTT += `${segmentNumber}\n`;
                    combinedVTT += segment.join('\n') + '\n\n';
                    segmentNumber++;
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
        },

        /**
         * Splits a VTT string into batches of up to maxChars characters, ensuring the first batch includes the WEBVTT header if present
         * @param {string} vttString - The full VTT string
         * @param {number} maxChars - Maximum characters per batch (default 2000)
         * @returns {Array<string>} Array of VTT batches
         */
        splitVTTIntoBatches(vttString, maxChars = 2000) {
            const segments = vttString.split('\n\n');
            let batches = [];
            let currentBatch = [];
            let currentLength = 0;

            // Handle WEBVTT header
            if (segments[0].trim().toUpperCase() === 'WEBVTT') {
                currentBatch.push('WEBVTT');
                currentLength += 'WEBVTT\n\n'.length;
                segments.shift();
            }

            for (const segment of segments) {
                // Handle oversized segment
                if (segment.length + 2 > maxChars) {
                    // Flush current batch if not empty
                    if (currentBatch.length > 0) {
                        batches.push(currentBatch.join('\n\n'));
                        currentBatch = [];
                        currentLength = 0;
                    }
                    // Truncate and add as its own batch
                    let truncated = segment.slice(0, maxChars - 2) + '…'; // Add ellipsis to indicate truncation
                    batches.push(truncated);
                    continue;
                }
                // Normal batching logic
                if (currentLength + segment.length + 2 > maxChars && currentBatch.length > 0) {
                    batches.push(currentBatch.join('\n\n'));
                    currentBatch = [];
                    currentLength = 0;
                }
                currentBatch.push(segment);
                currentLength += segment.length + 2;
            }
            if (currentBatch.length > 0) {
                batches.push(currentBatch.join('\n\n'));
            }
            return batches;
        }
    }
};
