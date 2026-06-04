You are evaluating whether a conversation block contains information worth extracting and preserving as personal memory.

## Conversation Block

{CONVERSATION_BLOCK}

## Evaluation Criteria

A conversation is **worth processing** if it contains ANY of:
- Decisions made (technical, business, personal)
- Action items or task assignments
- Important knowledge shared (architecture, processes, domain expertise)
- Relationship or organizational context
- Plans, deadlines, or commitments
- Problems identified and solutions discussed
- Opinions or preferences that reveal character or values

A conversation is **NOT worth processing** if it is purely:
- Social pleasantries with no substance ("好的", "收到", "谢谢")
- Forwarded content with no discussion
- Automated notifications restated by a person
- Logistics with no decision component ("几点开会？" → "3点")

## Response Format

Respond with a JSON object:
```json
{
  "worth_processing": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "topics": ["topic1", "topic2"]
}
```
