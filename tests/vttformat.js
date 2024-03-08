function formatWebVTT(webVTTString) {
	// Split the input into lines
	const lines = webVTTString.split("\n");
	let formattedLines = [];

	for (let i = 0; i < lines.length; i++) {
		
        const clearedLine = lines[i].trim();
        
		if (clearedLine.match(/^\d{2}:\d{2}:\d{2}.\d{3}.*/)) {
			// Keep only the start timestamp
			const timestampParts = clearedLine.split(" --> ");
			console.log(timestampParts);
			formattedLines.push(timestampParts[0]);
		}
		// Check and format speaker lines
		else if (clearedLine.match(/<v ([^>]+)>(.*)/)) {
			const speakerMatch = clearedLine.match(/<v ([^>]+)>(.*)/);
			// Adjust speaker format
			if (speakerMatch) {
				formattedLines.push(`${speakerMatch[1]}: ${speakerMatch[2].trim()}`);
			}
		} else {
			// For lines that do not need formatting, push them as they are
			formattedLines.push(clearedLine);
		}
	}

	return formattedLines.join("\n");
}

// Example WebVTT string
const webVTTString = `WEBVTT

  NOTE
  Transcription provided by Deepgram
  Request Id: 9abe0ff7-58af-42c5-bc07-cc6d0f63f2c8
  Created: 2024-02-10T17:09:31.194Z
  Duration: 86.51756
  Channels: 1
  
  00:00:02.159 --> 00:00:02.480
  <v Speaker 0>How can
  
  00:00:02.480 --> 00:00:04.720
  <v Speaker 1>I connect with somebody when we don't have
  
  00:00:04.720 --> 00:00:07.600
  <v Speaker 1>the same interests? This is a really good
  
  00:00:07.600 --> 00:00:07.855
  <v Speaker 1>question.
  
  00:00:07.935 --> 00:00:08.895
  <v Speaker 0>It is a good question.
  
  00:00:08.895 --> 00:00:10.835
  <v Speaker 1>And I would like to know the answer.
  
  00:00:11.055 --> 00:00:13.695
  <v Speaker 0>Yeah? So yeah. I'll get you some answers.
  
  00:00:13.695 --> 00:00:15.135
  <v Speaker 1>So, like, when I go to a business
  
  00:00:15.135 --> 00:00:17.830
  <v Speaker 1>networking event, I have no trouble connecting with
  
  00:00:17.830 --> 00:00:20.550
  <v Speaker 1>people because it's usually people who have a
  
  00:00:20.550 --> 00:00:23.349
  <v Speaker 1>like mindset that I have. Yes. I mean,
  
  00:00:23.349 --> 00:00:24.950
  <v Speaker 1>it's pretty similar. And even if they're not
  
  00:00:24.950 --> 00:00:26.935
  <v Speaker 1>doing the same kind of business, They're interested
  
  00:00:26.935 --> 00:00:30.055
  <v Speaker 1>in business or marketing. They're usually into health
  
  00:00:30.055 --> 00:00:31.735
  <v Speaker 1>and fitness, like, all kinds of stuff. So
  
  00:00:31.735 --> 00:00:33.415
  <v Speaker 1>I'm like, I'm in my element. I could
  
  00:00:33.415 --> 00:00:35.470
  <v Speaker 1>talk to anybody. But if I go to
  
  00:00:35.470 --> 00:00:37.650
  <v Speaker 1>say, like, a family reunion or a wedding,
  
  00:00:38.430 --> 00:00:40.590
  <v Speaker 1>like, I know I'm there just because of
  
  00:00:40.590 --> 00:00:44.605
  <v Speaker 1>familial, familial relationships. And I don't know like,
  
  00:00:44.605 --> 00:00:45.525
  <v Speaker 1>a lot of times, I don't know what
  
  00:00:45.525 --> 00:00:47.245
  <v Speaker 1>to say. I'm a lot more nervous to
  
  00:00:47.245 --> 00:00:49.905
  <v Speaker 1>go talk to people. What do I do?
  
  00:00:50.045 --> 00:00:51.405
  <v Speaker 1>And I Yeah. Hey. You're you're such an
  
  00:00:51.405 --> 00:00:52.380
  <v Speaker 1>extrovert. Right?
  
  00:00:52.540 --> 00:00:55.740
  <v Speaker 0>Oh, I'm definitely the opposite. The most at
  
  00:00:55.900 --> 00:00:56.400
  <v Speaker 1>introverted.
  
  00:00:58.140 --> 00:00:59.740
  <v Speaker 0>Yeah. So I've got some stuff for this
  
  00:00:59.740 --> 00:01:01.475
  <v Speaker 0>that I actually think is useful Despite my
  
  00:01:01.475 --> 00:01:07.495
  <v Speaker 0>introvertedness introversion? Whatever. Language is evolving. So first,
  
  00:01:07.955 --> 00:01:09.130
  <v Speaker 0>I I would challenge the idea that you
  
  00:01:09.130 --> 00:01:11.130
  <v Speaker 0>have nothing in common. People are pretty complex
  
  00:01:11.130 --> 00:01:13.130
  <v Speaker 0>and you might not know what you have
  
  00:01:13.130 --> 00:01:15.130
  <v Speaker 0>in common because there are a 1000000000 weird
  
  00:01:15.130 --> 00:01:16.810
  <v Speaker 0>things that I like that you're not gonna
  
  00:01:16.810 --> 00:01:19.015
  <v Speaker 0>know. Maybe you're like, oh, Martin likes language,
  
  00:01:19.075 --> 00:01:21.315
  <v Speaker 0>but you don't know any of the other
  
  00:01:21.315 --> 00:01:22.675
  <v Speaker 0>weird stuff. You don't know that I like
  
  00:01:22.675 --> 00:01:25.155
  <v Speaker 0>Mahmoodwad for whatever reason. You do now. You
  
  00:01:25.155 --> 00:01:26.295
  <v Speaker 0>don't know a lot of stuff.
  `;

const formattedWebVTT = formatWebVTT(webVTTString);
console.log(formattedWebVTT);
