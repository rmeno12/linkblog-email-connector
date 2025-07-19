import PostalMime from 'postal-mime';
import { createMimeMessage } from 'mimetext';
import { EmailMessage } from 'cloudflare:email';
import { Octokit } from 'octokit';
import { 
	validateUrl, 
	sanitizeText, 
	validateTags, 
	validateBranchName, 
	validateFilePath, 
	sanitizeCommitMessage,
	validateEmail,
	checkRateLimit 
} from './security';

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
		// Enhanced security: validate sender email format
		if (!validateEmail(message.from) || message.from !== env.LINKS_ALLOWED_SENDER) {
			console.warn(`Rejected email from unauthorized sender: ${message.from}`);
			message.setReject('Address not allowed');
			return;
		}

		// Rate limiting protection
		if (!checkRateLimit(message.from, 5, 300000)) { // 5 requests per 5 minutes
			console.warn(`Rate limit exceeded for: ${message.from}`);
			message.setReject('Rate limit exceeded');
			return;
		}

		console.log(`Processing email from: ${message.from}`);
		console.log(`Subject: ${sanitizeText(message.headers.get('subject') || 'No Subject')}`);

		try {
			const email = await PostalMime.parse(message.raw);
			
			// Validate email content exists
			if (!email.text || typeof email.text !== 'string') {
				throw new Error('Email content is missing or invalid');
			}

			// Validate subject exists
			if (!email.subject || typeof email.subject !== 'string') {
				throw new Error('Email subject is missing or invalid');
			}

			const parsed = parse(email.text);
			const { content, fileName } = generateFile(email.subject, parsed);
			const prUrl = await createGithubPR(env, fileName, content, email.subject);
			
			console.log(`Successfully created PR`);
			await message.reply(makeSuccessReply(message, prUrl));
		} catch (error) {
			// Security: Don't expose detailed error information
			console.error('Error processing email:', error);
			const safeErrorMessage = error instanceof Error ? 
				'Failed to process email content' : 
				'An unexpected error occurred';
			await message.reply(makeErrorReply(message, safeErrorMessage));
		}
	},
};

function parse(body: string): LinkPost {
	if (!body || typeof body !== 'string') {
		throw new Error('Email body is required');
	}

	// Sanitize input body
	const sanitizedBody = sanitizeText(body);
	
	const data: LinkPost = { url: '', tags: [], body: '' };
	const lines = sanitizedBody.split('\n');
	let isBody = false;
	let bodyLines: string[] = [];

	for (const line of lines) {
		if (isBody) {
			bodyLines.push(line);
			continue;
		}

		if (line.trim().toLowerCase() === 'body') {
			isBody = true;
			continue;
		}

		const parts = line.split(' ');
		const key = parts.shift()?.toLowerCase();
		const value = parts.join(' ');

		if (key && value) {
			if (key === 'url') {
				const trimmedUrl = value.trim();
				if (!validateUrl(trimmedUrl)) {
					throw new Error('Invalid or unsafe URL provided');
				}
				data.url = trimmedUrl;
			} else if (key === 'tags') {
				const rawTags = value.split(',').map(tag => tag.trim());
				data.tags = validateTags(rawTags);
				if (data.tags.length === 0) {
					throw new Error('At least one valid tag is required');
				}
			}
		}
	}

	data.body = sanitizeText(bodyLines.join('\n').trim()) + '\n';
	
	// Validate required fields
	if (!data.url) {
		throw new Error('URL is required');
	}
	if (data.tags.length === 0) {
		throw new Error('At least one tag is required');
	}
	if (!data.body.trim()) {
		throw new Error('Body content is required');
	}

	return data;
}

function generateFile(title: string, data: LinkPost): { content: string; fileName: string } {
	// Sanitize title
	const sanitizedTitle = sanitizeText(title);
	if (!sanitizedTitle) {
		throw new Error('Title is required');
	}

	const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	const fileTitleSlug = sanitizedTitle
		.toLowerCase()
		.split(' ', 4)
		.join(' ')
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '');

	// Validate slug is not empty
	if (!fileTitleSlug) {
		throw new Error('Unable to generate valid filename from title');
	}

	// Create safe content with escaped JSON
	const tagsJson = JSON.stringify(data.tags);
	const content = `+++
title = "Link: ${sanitizedTitle}"
date = "${today}"

[taxonomies]
type = ["posts"]
tags = ${tagsJson}
+++

### [${sanitizedTitle}](${data.url})
${data.body}`;

	const fileName = `content/posts/links/${today}-${fileTitleSlug}.md`;
	
	// Validate the generated file path is safe
	if (!validateFilePath(fileName)) {
		throw new Error('Generated file path is invalid');
	}

	return { content, fileName };
}

async function createGithubPR(env: Env, fileName: string, fileContent: string, commitTitle: string): Promise<string> {
	// Validate inputs
	if (!validateFilePath(fileName)) {
		throw new Error('Invalid file path');
	}

	const sanitizedCommitTitle = sanitizeCommitMessage(commitTitle);
	
	const octokit = new Octokit({
		auth: env.GITHUB_TOKEN,
	});

	const owner = env.GITHUB_USER;
	const repo = env.GITHUB_REPO;
	const defaultBranch = 'master';

	try {
		const refRes = await octokit.rest.git.getRef({
			owner,
			repo,
			ref: `heads/${defaultBranch}`,
		});
		const baseSha = refRes.data.object.sha;

		// Create a secure branch name
		const branchSuffix = fileName.split('/')[3]?.replace('.md', '') || 'link-post';
		const newBranchName = `link/${branchSuffix}`;
		
		// Validate branch name is safe
		if (!validateBranchName(newBranchName)) {
			throw new Error('Generated branch name is invalid');
		}

		// Check if branch already exists to avoid conflicts
		try {
			await octokit.rest.git.getRef({
				owner,
				repo,
				ref: `heads/${newBranchName}`,
			});
			// Branch exists, add timestamp to make unique
			const timestamp = Date.now().toString(36);
			const uniqueBranchName = `${newBranchName}-${timestamp}`;
			if (!validateBranchName(uniqueBranchName)) {
				throw new Error('Unable to generate unique branch name');
			}
			await createBranchAndFile(octokit, owner, repo, uniqueBranchName, baseSha, fileName, fileContent, sanitizedCommitTitle, env);
			return await createPullRequest(octokit, owner, repo, uniqueBranchName, defaultBranch, sanitizedCommitTitle);
		} catch (error: any) {
			if (error.status === 404) {
				// Branch doesn't exist, create it
				await createBranchAndFile(octokit, owner, repo, newBranchName, baseSha, fileName, fileContent, sanitizedCommitTitle, env);
				return await createPullRequest(octokit, owner, repo, newBranchName, defaultBranch, sanitizedCommitTitle);
			}
			throw error;
		}
	} catch (error: any) {
		console.error('GitHub API error:', error.message);
		throw new Error('Failed to create GitHub PR');
	}
}

async function createBranchAndFile(
	octokit: Octokit, 
	owner: string, 
	repo: string, 
	branchName: string, 
	baseSha: string, 
	fileName: string, 
	fileContent: string, 
	commitTitle: string,
	env: Env
): Promise<void> {
	// Create the new branch
	await octokit.rest.git.createRef({
		owner,
		repo,
		ref: `refs/heads/${branchName}`,
		sha: baseSha,
	});

	// Create the file in the new branch
	await octokit.rest.repos.createOrUpdateFileContents({
		owner,
		repo,
		path: fileName,
		message: `link-email: add post ${commitTitle}`,
		content: btoa(fileContent),
		branch: branchName,
		committer: { name: 'linkblog-email-connector', email: 'links@rahulmenon.dev' },
		author: { name: env.GITHUB_USER, email: env.LINKS_ALLOWED_SENDER },
	});
}

async function createPullRequest(
	octokit: Octokit,
	owner: string,
	repo: string,
	headBranch: string,
	baseBranch: string,
	commitTitle: string
): Promise<string> {
	const prRes = await octokit.rest.pulls.create({
		owner,
		repo,
		title: `Add linkpost: ${commitTitle}`,
		head: headBranch,
		base: baseBranch,
		body: 'Automated post creation from linkblog-email-connector.',
	});

	return prRes.data.html_url;
}

function makeReply(message: ForwardableEmailMessage) {
	const originalMessageId = message.headers.get('Message-ID');
	const originalReferences = message.headers.get('References');
	const originalSubject = message.headers.get('subject') || 'No Subject';
	
	// Sanitize subject to prevent header injection
	const sanitizedSubject = sanitizeText(originalSubject);
	
	const references = [originalReferences, originalMessageId]
		.filter(Boolean) // Removes null/empty values
		.join(' ');
	const subjectPrefix = sanitizedSubject.toLowerCase().startsWith('re:') ? '' : 'Re: ';

	const reply = createMimeMessage();
	reply.setHeader('In-Reply-To', originalMessageId);
	reply.setHeader('References', references);
	reply.setSubject(subjectPrefix + sanitizedSubject);
	reply.setSender({ name: 'links-email-connector', addr: 'links@rahulmenon.dev' });
	reply.setRecipient(message.from);

	return reply;
}

function makeSuccessReply(message: ForwardableEmailMessage, prUrl: string) {
	const reply = makeReply(message);
	
	// Validate PR URL before including in response
	if (!validateUrl(prUrl)) {
		throw new Error('Invalid PR URL generated');
	}
	
	reply.addMessage({
		contentType: 'text/plain',
		data: `Successfully processed email. View PR at ${prUrl}`,
	});

	const replyMessage = new EmailMessage('links@rahulmenon.dev', message.from, reply.asRaw());
	return replyMessage;
}

function makeErrorReply(message: ForwardableEmailMessage, errorMessage: string) {
	const reply = makeReply(message);
	
	// Sanitize error message to prevent information disclosure
	const safeErrorMessage = sanitizeText(errorMessage);
	
	reply.addMessage({
		contentType: 'text/plain',
		data: `Error encountered in processing the email: ${safeErrorMessage}`,
	});

	const replyMessage = new EmailMessage('links@rahulmenon.dev', message.from, reply.asRaw());
	return replyMessage;
}
