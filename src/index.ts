import PostalMime from 'postal-mime';
import { createMimeMessage } from 'mimetext';
import { EmailMessage } from 'cloudflare:email';

export interface Env {
	LINKS_ALLOWED_SENDER: string;
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
			console.log('--- Email Body (Text) ---');
			console.log(email.text);

			// if (email.attachments.length > 0) {
			// 	console.log(`Found ${email.attachments.length} attachments.`);
			// 	email.attachments.forEach((attachment) => {
			// 		console.log(`- Attachment: ${attachment.filename} (${attachment.mimeType})`);
			// 	});
			// }
			await message.reply(makeSuccessReply(message));
		} catch (error) {
			console.error('Error parsing email:', error);
			await message.reply(makeErrorReply(message, error));
		}
	},
};

function makeReply(message: ForwardableEmailMessage) {
	const originalMessageId = message.headers.get('Message-ID');
	const originalReferences = message.headers.get('References');
	const originalSubject = message.headers.get('subject') || 'No Subject';
	console.log(originalReferences);
	const references = [originalReferences, originalMessageId]
		.filter(Boolean) // Removes null/empty values
		.join(' ');
	console.log(references);
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

function makeSuccessReply(message: ForwardableEmailMessage) {
	const reply = makeReply(message);
	reply.addMessage({
		contentType: 'text/plain',
		data: `Successfully processed email`,
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
