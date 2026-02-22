import { isDataModel, isTypeDef, type DataField, type DataModel, type DataModelAttribute, type Procedure, type TypeDef } from '@zenstackhq/language/ast';
import { getAllFields } from '@zenstackhq/language/utils';
import {
    extractDocMeta,
    extractFieldDocExample,
    getAttrName,
    getDefaultValue,
    getFieldAttributes,
    getFieldTypeName,
    getRelativeSourcePath,
    isFieldRequired,
    stripCommentPrefix,
} from '../extractors';
import type { ModelPageProps, RelationType } from '../types';
import { breadcrumbs, declarationBlock, generatedHeader, navigationFooter, referencesSection, renderDescription, renderMetadata, sectionHeading } from './common';

interface ValidationRule {
    fieldName: string;
    rule: string;
}

function isModelReferencedByProc(proc: Procedure, modelName: string): boolean {
    if (proc.returnType.reference?.ref?.name === modelName) return true;
    if (proc.returnType.type === modelName) return true;
    for (const param of proc.params) {
        if (param.type.reference?.ref?.name === modelName) return true;
        if (param.type.type === modelName) return true;
    }
    return false;
}

function collectValidationRules(orderedFields: DataField[], modelAttrs: DataModelAttribute[]): ValidationRule[] {
    const rules: ValidationRule[] = [];

    for (const field of orderedFields) {
        for (const attr of field.attributes) {
            const attrDecl = attr.decl.ref;
            if (!attrDecl) continue;
            const isValidation = attrDecl.attributes.some(
                (ia) => ia.decl.ref?.name === '@@@validation',
            );
            if (isValidation) {
                rules.push({ fieldName: field.name, rule: `\`${getAttrName(attr)}\`` });
            }
        }
    }

    const validateAttrs = modelAttrs.filter((a) => a.decl.ref?.name === '@@validate');
    for (const attr of validateAttrs) {
        const condition = attr.args[0]?.$cstNode?.text ?? '';
        const messageArg = attr.args[1]?.$cstNode?.text?.replace(/^['"]|['"]$/g, '');
        const pathArg = attr.args[2]?.$cstNode?.text?.replace(/^['"]|['"]$/g, '');

        const fieldName = pathArg ?? 'Model';
        let ruleText = `\`${condition}\``;
        if (messageArg) {
            ruleText += ` — *${messageArg}*`;
        }
        rules.push({ fieldName, rule: ruleText });
    }

    return rules;
}

function collectFKFieldNames(allFields: DataField[]): Set<string> {
    const fkNames = new Set<string>();
    for (const field of allFields) {
        const relationAttr = field.attributes.find((a) => getAttrName(a) === '@relation');
        if (!relationAttr) continue;
        const cstText = relationAttr.$cstNode?.text ?? '';
        const fieldsMatch = cstText.match(/fields:\s*\[([^\]]+)\]/);
        if (fieldsMatch) {
            for (const name of fieldsMatch[1]!.split(',').map((s) => s.trim())) {
                fkNames.add(name);
            }
        }
    }
    return fkNames;
}

// ── Section renderers ───────────────────────────────────────────────────

function renderHeader(props: ModelPageProps): string[] {
    const docMeta = extractDocMeta(props.model.attributes);
    const isDeprecated = !!docMeta.deprecated;
    const nameDisplay = isDeprecated ? `~~${props.model.name}~~` : props.model.name;

    const badgeParts = ['<kbd>Model</kbd>'];
    const hasAuth = props.model.attributes.some((a) => a.decl.ref?.name === '@@auth');
    const hasDelegate = props.model.attributes.some((a) => a.decl.ref?.name === '@@delegate');
    if (hasAuth) badgeParts.push('<kbd>Auth</kbd>');
    if (hasDelegate) badgeParts.push('<kbd>Delegate</kbd>');
    if (isDeprecated) badgeParts.push('<kbd>Deprecated</kbd>');

    return [
        ...generatedHeader(props.options.genCtx),
        breadcrumbs('Models', props.model.name, '../'),
        '',
        `# ${nameDisplay} ${badgeParts.join(' ')}`,
        '',
    ];
}

function renderMetadataBlock(props: ModelPageProps): string[] {
    const docMeta = extractDocMeta(props.model.attributes);
    const sourcePath = getRelativeSourcePath(props.model, props.options.schemaDir);

    const mapAttr = props.model.attributes.find((a) => a.decl.ref?.name === '@@map');
    const schemaAttr = props.model.attributes.find((a) => a.decl.ref?.name === '@@schema');
    const mappedTable = mapAttr?.args[0]?.$cstNode?.text?.replace(/^['"]|['"]$/g, '');
    const dbSchema = schemaAttr?.args[0]?.$cstNode?.text?.replace(/^['"]|['"]$/g, '');

    return [
        ...renderMetadata(docMeta, sourcePath, { mappedTable, dbSchema }),
        ...declarationBlock(props.model.$cstNode?.text, sourcePath),
    ];
}

function renderEntityDiagram(modelName: string, allFields: DataField[]): string[] {
    const fkNames = collectFKFieldNames(allFields);
    const scalarFields = allFields.filter(
        (f) => !(f.type.reference?.ref && isDataModel(f.type.reference.ref)),
    );
    if (scalarFields.length === 0) return [];

    const lines = [...sectionHeading('Entity Diagram'), '', '```mermaid', 'erDiagram', `    ${modelName} {`];

    for (const field of scalarFields) {
        const typeName = field.type.reference?.ref?.name ?? field.type.type ?? 'Unknown';
        const hasId = field.attributes.some((a) => getAttrName(a) === '@id');
        const hasUnique = field.attributes.some((a) => getAttrName(a) === '@unique');

        let annotation = '';
        if (hasId) annotation = ' PK';
        else if (hasUnique) annotation = ' UK';
        else if (fkNames.has(field.name)) annotation = ' FK';

        lines.push(`        ${typeName} ${field.name}${annotation}`);
    }

    lines.push('    }', '```', '');
    return lines;
}

function renderTableOfContents(sections: string[]): string[] {
    if (sections.length <= 1) return [];
    const tocLinks = sections.map((s) => {
        const anchor = s.toLowerCase().replace(/\s+/g, '-');
        return `[${s}](#${anchor})`;
    });
    return [tocLinks.join(' · '), ''];
}

function renderMixinsSection(mixinRefs: TypeDef[]): string[] {
    if (mixinRefs.length === 0) return [];
    const lines = [...sectionHeading('Mixins'), ''];
    for (const mixin of mixinRefs) {
        lines.push(`- [${mixin.name}](../types/${mixin.name}.md)`);
    }
    lines.push('');
    return lines;
}

function renderFieldsSection(model: DataModel, orderedFields: DataField[]): string[] {
    if (orderedFields.length === 0) return [];

    const lines = [...sectionHeading('Fields'), '', '| Field | Type | Required | Default | Attributes | Source | Description |', '| --- | --- | --- | --- | --- | --- | --- |'];

    for (const field of orderedFields) {
        const fieldDescription = stripCommentPrefix(field.comments);
        const isComputed = field.attributes.some((a) => getAttrName(a) === '@computed');
        const isIgnored = field.attributes.some((a) => getAttrName(a) === '@ignore');
        const inheritedFrom =
            isDataModel(field.$container) && field.$container !== model
                ? field.$container.name
                : undefined;
        const fromMixin = isTypeDef(field.$container) ? field.$container.name : undefined;

        let source = '—';
        if (fromMixin) {
            source = `[${fromMixin}](../types/${fromMixin}.md)`;
        } else if (inheritedFrom) {
            source = `[${inheritedFrom}](./${inheritedFrom}.md)`;
        }

        let typeCol = getFieldTypeName(field, true);
        if (isComputed) typeCol += ' <kbd>computed</kbd>';
        if (isIgnored) typeCol += ' <kbd>ignored</kbd>';

        const descParts: string[] = [];
        const example = extractFieldDocExample(field);
        if (example) descParts.push(`Example: \`${example}\``);
        if (fieldDescription) descParts.push(fieldDescription);
        const desc = descParts.length > 0 ? descParts.join(' ') : '—';
        const fieldAnchor = `<a id="field-${field.name}"></a>`;
        lines.push(
            `| ${fieldAnchor}\`${field.name}\` | ${typeCol} | ${isFieldRequired(field) ? 'Yes' : 'No'} | ${getDefaultValue(field)} | ${getFieldAttributes(field)} | ${source} | ${desc} |`,
        );
    }
    lines.push('');
    return lines;
}

function renderRelationshipsSection(modelName: string, relationFields: DataField[]): string[] {
    if (relationFields.length === 0) return [];

    const lines = [...sectionHeading('Relationships'), '', '| Field | Related Model | Type |', '| --- | --- | --- |'];
    const mermaidLines: string[] = [];
    const seenPairs = new Set<string>();

    for (const field of relationFields) {
        const relatedModel = field.type.reference?.ref?.name ?? '';
        let relType: RelationType;
        if (field.type.array) {
            relType = 'One\u2192Many';
        } else if (field.type.optional) {
            relType = 'Many\u2192One?';
        } else {
            relType = 'Many\u2192One';
        }
        lines.push(`| \`${field.name}\` | [${relatedModel}](./${relatedModel}.md) | ${relType} |`);

        const pairKey = [modelName, relatedModel].sort().join('--');
        if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            if (field.type.array) {
                mermaidLines.push(`    ${modelName} ||--o{ ${relatedModel} : "${field.name}"`);
            } else {
                mermaidLines.push(`    ${modelName} }o--|| ${relatedModel} : "${field.name}"`);
            }
        }
    }
    lines.push('');

    if (mermaidLines.length > 0) {
        lines.push('```mermaid', 'erDiagram', ...mermaidLines, '```', '');
    }
    return lines;
}

function renderPoliciesSection(policyAttrs: DataModelAttribute[]): string[] {
    if (policyAttrs.length === 0) return [];

    return [
        ...sectionHeading('Access Policies'), '',
        '> [!IMPORTANT]',
        '> Operations are **denied by default**. `@@allow` rules grant access; `@@deny` rules override any allow.', '',
        '| Operation | Rule | Effect |',
        '| --- | --- | --- |',
        ...policyAttrs.map((attr) => {
            const effect = attr.decl.ref?.name === '@@allow' ? 'Allow' : 'Deny';
            const operationArg = attr.args[0]?.$cstNode?.text ?? '';
            const operation = operationArg.replace(/^['"]|['"]$/g, '');
            const condition = attr.args[1]?.$cstNode?.text ?? '';
            return `| ${operation} | \`${condition}\` | ${effect} |`;
        }),
        '',
    ];
}

function renderIndexesSection(indexAttrs: DataModelAttribute[]): string[] {
    if (indexAttrs.length === 0) return [];

    const lines = [...sectionHeading('Indexes'), '', '| Fields | Type |', '| --- | --- |'];
    for (const attr of indexAttrs) {
        const attrName = attr.decl.ref?.name ?? '';
        let indexType: string;
        if (attrName === '@@unique') {
            indexType = 'Unique';
        } else if (attrName === '@@id') {
            indexType = 'Primary';
        } else {
            indexType = 'Index';
        }
        const fieldsArg = attr.args[0]?.$cstNode?.text ?? '';
        lines.push(`| \`${fieldsArg}\` | ${indexType} |`);
    }
    lines.push('');
    return lines;
}

function renderValidationSection(rules: ValidationRule[]): string[] {
    if (rules.length === 0) return [];
    const lines = [...sectionHeading('Validation Rules'), '', '| Field | Rule |', '| --- | --- |'];
    for (const { fieldName, rule } of rules) {
        const nameCol = fieldName === 'Model' ? fieldName : `\`${fieldName}\``;
        lines.push(`| ${nameCol} | ${rule} |`);
    }
    lines.push('');
    return lines;
}

function renderProceduresSection(procedures: Procedure[], modelName: string): string[] {
    const referenced = procedures
        .filter((p) => isModelReferencedByProc(p, modelName))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (referenced.length === 0) return [];

    const lines = [...sectionHeading('Used in Procedures'), ''];
    for (const proc of referenced) {
        const kind = proc.mutation ? 'mutation' : 'query';
        lines.push(`- [${proc.name}](../procedures/${proc.name}.md) — *${kind}*`);
    }
    lines.push('');
    return lines;
}

// ── Main composition ────────────────────────────────────────────────────

/** Renders a full documentation page for a data model, including fields, relationships, policies, validation, and procedures. */
export function renderModelPage(props: ModelPageProps): string {
    const { model, options, procedures } = props;
    const allFields = getAllFields(model, true);

    const orderedFields =
        options.fieldOrder === 'alphabetical'
            ? [...allFields].sort((a, b) => a.name.localeCompare(b.name))
            : [...allFields];

    const relationFields = allFields
        .filter((f) => f.type.reference?.ref && isDataModel(f.type.reference.ref))
        .sort((a, b) => a.name.localeCompare(b.name));

    const policyAttrs = model.attributes.filter((a) => {
        const name = a.decl.ref?.name ?? '';
        return name === '@@allow' || name === '@@deny';
    });

    const indexAttrs = model.attributes.filter((a) => {
        const name = a.decl.ref?.name ?? '';
        return name === '@@index' || name === '@@unique' || name === '@@id';
    });

    const validationRules = collectValidationRules(orderedFields, model.attributes);

    const mixinRefs = model.mixins
        .map((ref) => ref.ref)
        .filter((t): t is NonNullable<typeof t> => t != null)
        .sort((a, b) => a.name.localeCompare(b.name));

    const sections: string[] = [];
    if (mixinRefs.length > 0) sections.push('Mixins');
    if (orderedFields.length > 0) sections.push('Fields');
    if (options.includeRelationships && relationFields.length > 0) sections.push('Relationships');
    if (options.includePolicies && policyAttrs.length > 0) sections.push('Access Policies');
    if (options.includeIndexes && indexAttrs.length > 0) sections.push('Indexes');
    if (options.includeValidation && validationRules.length > 0) sections.push('Validation Rules');
    const referencingProcs = procedures.filter((p) => isModelReferencedByProc(p, model.name));
    if (referencingProcs.length > 0) sections.push('Used in Procedures');

    return [
        ...renderHeader(props),
        ...renderDescription(model.comments, stripCommentPrefix),
        ...renderMetadataBlock(props),
        ...renderEntityDiagram(model.name, [...allFields]),
        ...renderTableOfContents(sections),
        ...renderMixinsSection(mixinRefs),
        ...renderFieldsSection(model, orderedFields),
        ...(options.includeRelationships ? renderRelationshipsSection(model.name, relationFields) : []),
        ...(options.includePolicies ? renderPoliciesSection(policyAttrs) : []),
        ...(options.includeIndexes ? renderIndexesSection(indexAttrs) : []),
        ...(options.includeValidation ? renderValidationSection(validationRules) : []),
        ...renderProceduresSection(procedures, model.name),
        ...referencesSection('model'),
        ...navigationFooter(props.navigation),
    ].join('\n');
}
