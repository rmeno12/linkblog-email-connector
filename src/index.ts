import PostalMime from 'postal-mime';
import { createMimeMessage } from 'mimetext';
import { EmailMessage } from 'cloudflare:email';
import { Octokit } from 'octokit';

export interface Env {
	LINKS_ALLOWED_SENDER: string;
	GITHUB_TOKEN: string;
	GITHUB_REPO: string;
	GITHUB_USER: string;
}

interface LinkPost {
	url: string;
	tags: string[];
	body: string;
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
		if (message.from != env.LINKS_ALLOWED_SENDER) {
			message.setReject('Address not allowed');
		}
		console.log(`Received email from: ${message.from}`);
		console.log(`To: ${message.to}`);
		console.log(`Subject: ${message.headers.get('subject')}`);

		try {
			const email = await PostalMime.parse(message.raw);
			// @ts-ignore
			const parsed = parse(email.text);
			// @ts-ignore
			const { content, fileName } = generateFile(email.subject, parsed);
			// @ts-ignore
			const prUrl = await createGithubPR(env, fileName, content, email.subject);
			console.log(`Created PR at ${prUrl}`);

			await message.reply(makeSuccessReply(message, prUrl));
		} catch (error) {
			console.error('Error parsing email:', error);
			await message.reply(makeErrorReply(message, error));
		}
	},
};

function parse(body: string): LinkPost {
	const data: LinkPost = { url: '', tags: [], body: '' };
	const lines = body.split('\n');
	let isBody = false;
	let bodyLines: string[] = [];

	for (const line of lines) {
		if (isBody) {
			bodyLines.push(line);
			continue;
		}

		if (line.trim().toLowerCase() == 'body') {
			isBody = true;
			continue;
		}

		const parts = line.split(' ');
		const key = parts.shift()?.toLowerCase();
		const value = parts.join(' ');

		if (key && value) {
			if (key == 'url') data.url = value;
			else if (key == 'tags') data.tags = value.split(',').map((v, i, a) => v.trim());
		}
	}
	data.body = bodyLines.join('\n').trim() + '\n';
	if (data.url == '' || data.tags.length == 0 || data.body == '') {
		throw Error(`missing fields in post data: ${data}`);
	}

	return data;
}

function generateFile(title: string, data: LinkPost): { content: string; fileName: string } {
	const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	const fileTitleSlug = title
		.toLowerCase()
		.split(' ', 4)
		.join(' ')
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '');

	const content = `+++
title = "Link: ${title}"
date = "${today}"

[taxonomies]
type = ["posts"]
tags = ${JSON.stringify(data.tags)}
+++

### [${title}](${data.url})
${data.body}`;

	const fileName = `content/posts/links/${today}-${fileTitleSlug}.md`;
	return { content, fileName };
}

async function createGithubPR(env: Env, fileName: string, fileContent: string, commitTitle: string): Promise<string> {
	const octokit = new Octokit({
		auth: env.GITHUB_TOKEN,
	});

	const owner = env.GITHUB_USER;
	const repo = env.GITHUB_REPO;
	const defaultBranch = 'master';

	const refRes = await octokit.rest.git.getRef({
		owner,
		repo,
		ref: `heads/${defaultBranch}`,
	});
	const baseSha = refRes.data.object.sha;

	// 2. Create a new branch
	const newBranchName = `link/${fileName.split('/')[3].replace('.md', '')}`;
	await octokit.rest.git.createRef({
		owner,
		repo,
		ref: `refs/heads/${newBranchName}`,
		sha: baseSha,
	});

	// 3. Create the file in the new branch
	await octokit.rest.repos.createOrUpdateFileContents({
		owner,
		repo,
		path: fileName,
		message: `link-email: add post ${commitTitle}`,
		content: btoa(fileContent),
		branch: newBranchName,
		committer: { name: 'linkblog-email-connector', email: 'links@rahulmenon.dev' },
		author: { name: env.GITHUB_USER, email: env.LINKS_ALLOWED_SENDER },
	});

	// 4. Create the Pull Request
	const prRes = await octokit.rest.pulls.create({
		owner,
		repo,
		title: `Add linkpost: ${commitTitle}`,
		head: newBranchName,
		base: defaultBranch,
		body: 'Automated post creation from linkblog-email-connector.',
	});

	return prRes.data.html_url;
}

function makeReply(message: ForwardableEmailMessage) {
	const originalMessageId = message.headers.get('Message-ID');
	const originalReferences = message.headers.get('References');
	const originalSubject = message.headers.get('subject') || 'No Subject';
	const references = [originalReferences, originalMessageId]
		.filter(Boolean) // Removes null/empty values
		.join(' ');
	const subjectPrefix = originalSubject.toLowerCase().startsWith('re:') ? '' : 'Re: ';

	const reply = createMimeMessage();
	// @ts-ignore
	reply.setHeader('In-Reply-To', originalMessageId);
	reply.setHeader('References', references);
	reply.setSubject(subjectPrefix + originalSubject);
	reply.setSender({ name: 'links-email-connector', addr: 'links@rahulmenon.dev' });
	reply.setRecipient(message.from);

	return reply;
}

function makeSuccessReply(message: ForwardableEmailMessage, prUrl: string) {
	const reply = makeReply(message);
	reply.addMessage({
		contentType: 'text/plain',
		data: `Successfully processed email. View PR at ${prUrl}`,
	});

	const replyMessage = new EmailMessage('links@rahulmenon.dev', message.from, reply.asRaw());
	return replyMessage;
}

function makeErrorReply(message: ForwardableEmailMessage, error: unknown) {
	const reply = makeReply(message);
	reply.addMessage({
		contentType: 'text/plain',
		data: `Error encountered in processing the email: ${error}`,
	});

	const replyMessage = new EmailMessage('links@rahulmenon.dev', message.from, reply.asRaw());
	return replyMessage;
}
