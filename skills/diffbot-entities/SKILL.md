---
name: diffbot-entities
description: "Identify and resolve named entities in text using the Diffbot NLP API. Links mentions to Diffbot Knowledge Graph entities with confidence scores and sentiment. Use when the user wants to extract entities from text, do NER (named entity recognition), identify companies or people mentioned, or get Diffbot IDs for entities. Triggers on: identify entities, entity recognition, NER, find entities in text, extract entities, entity linking, diffbot NLP, named entity."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "🧠", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot Entities (NLP)

Identify and resolve named entities in text with the `diffbot_resolve_entities` tool. Each entity (people, organizations, places, products) is linked to a Diffbot Knowledge Graph record with confidence, salience, and sentiment scores. Use it for named entity recognition, to find which companies or people a document is actually about, or to turn unstructured text into canonical entity ids. Token setup is described in $diffbot-dql.

```
diffbot_resolve_entities(text="<plain text>", lang="en")
```

| Parameter | Default | Description |
| --- | --- | --- |
| `text` | required | The text to analyze. Plain text, not HTML or markdown |
| `lang` | auto-detect | Language code of the text (`en`, `es`, `fr`, ...). Set explicitly for better accuracy on non-English text |

## Output

| Field | Description |
| --- | --- |
| `sentiment` | Document-level sentiment, -1 to +1 |
| `entities[].name` | The entity as resolved |
| `entities[].types` | Entity types (`Organization`, `Person`, `Place`, `Product`, ...) |
| `entities[].confidence` | 0-1 score for entity resolution accuracy: is this the right KG record? |
| `entities[].salience` | 0-1 prominence in the text: how central is this entity? |
| `entities[].sentiment` | Sentiment toward this entity specifically |
| `entities[].id` | KG entity id, usable in DQL `id:` lookups; `null` when the mention was recognized but not linked |
| `entities[].mentions` | How many times it was mentioned |
| `dql_filter` | An `id:or("...","...")` clause over every linked entity; `null` when nothing was linked |

## Use entity ids in DQL

`dql_filter` is the bridge from free text to structured records. Paste it into a `diffbot_dql` query with the right type ($diffbot-dql):

```
diffbot_resolve_entities(text="Apple, Microsoft, and Google dominate cloud AI.")
# -> dql_filter: id:or("EiqAqBMJHMT","EL7WL3J","EiCxSaRJP")

diffbot_dql(query='type:Organization id:or("EiqAqBMJHMT","EL7WL3J","EiCxSaRJP")', fields="name,Name;nbEmployees,Employees;homepageUri,Website")
```

This is much faster than a name-based DQL query because id lookups bypass full-text search, and it sidesteps the contains-matching over-match (`name:"Apple"` is 68,068 organizations).

## Tips

- **Confidence vs salience**: confidence is about resolution accuracy; salience is about topic importance. A high-salience, low-confidence entity is central to the text but may be linked to the wrong record.
- Entities without an id were recognized but not linked to the KG (proper-noun detection without a record match); they cannot be looked up with `diffbot_dql`.
- To pull the entities out of a web page, `diffbot_extract` it first ($diffbot-extract) and pass the `text` field here.
