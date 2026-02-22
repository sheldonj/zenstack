import { type DataField, type DataModel } from '@zenstackhq/language/ast';
import {
    extractDocMeta,
    getDefaultValue,
    getFieldAttributes,
    getFieldTypeName,
    getRelativeSourcePath,
    isFieldRequired,
    stripCommentPrefix,
} from '../extractors';
import type { ViewPageProps } from '../types';
import { breadcrumbs, declarationBlock, generatedHeader, navigationFooter, referencesSection, renderDescription, renderMetadata, sectionHeading } from './common';

function renderHeader(props: ViewPageProps): string[] {
    const docMeta = extractDocMeta(props.view.attributes);
    const isDeprecated = !!docMeta.deprecated;
    const nameDisplay = isDeprecated ? `~~${props.view.name}~~` : props.view.name;
    const badges = isDeprecated ? ' <kbd>View</kbd> <kbd>Deprecated</kbd>' : ' <kbd>View</kbd>';

    return [
        ...generatedHeader(props.options.genCtx),
        breadcrumbs('Views', props.view.name, '../'),
        '',
        `# ${nameDisplay}${badges}`,
        '',
    ];
}

function renderMetadataBlock(props: ViewPageProps): string[] {
    const docMeta = extractDocMeta(props.view.attributes);
    const sourcePath = getRelativeSourcePath(props.view, props.options.schemaDir);
    return [
        ...renderMetadata(docMeta, sourcePath),
        ...declarationBlock(props.view.$cstNode?.text, sourcePath),
    ];
}

function renderErDiagram(view: DataModel): string[] {
    if (view.fields.length === 0) return [];
    const lines = ['```mermaid', 'erDiagram', `    ${view.name} {`];
    for (const field of view.fields) {
        const typeName = field.type.reference?.ref?.name ?? field.type.type ?? 'Unknown';
        lines.push(`        ${typeName} ${field.name}`);
    }
    lines.push('    }', '```', '');
    return lines;
}

function orderFields(fields: DataField[], order: 'declaration' | 'alphabetical'): DataField[] {
    return order === 'alphabetical'
        ? [...fields].sort((a, b) => a.name.localeCompare(b.name))
        : [...fields];
}

function renderFieldsSection(fields: DataField[]): string[] {
    if (fields.length === 0) return [];
    const lines = [
        ...sectionHeading('Fields'), '',
        '| Field | Type | Required | Default | Attributes | Description |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const field of fields) {
        const fieldDescription = stripCommentPrefix(field.comments) || '—';
        const fieldAnchor = `<a id="field-${field.name}"></a>`;
        lines.push(
            `| ${fieldAnchor}\`${field.name}\` | ${getFieldTypeName(field, false)} | ${isFieldRequired(field) ? 'Yes' : 'No'} | ${getDefaultValue(field)} | ${getFieldAttributes(field)} | ${fieldDescription} |`,
        );
    }
    lines.push('');
    return lines;
}

/** Renders a full documentation page for a database view, including an ER diagram and fields table. */
export function renderViewPage(props: ViewPageProps): string {
    const sortedFields = orderFields(props.view.fields, props.options.fieldOrder);

    return [
        ...renderHeader(props),
        ...renderDescription(props.view.comments, stripCommentPrefix),
        ...renderMetadataBlock(props),
        ...renderErDiagram(props.view),
        ...renderFieldsSection(sortedFields),
        ...referencesSection('view'),
        ...navigationFooter(props.navigation),
    ].join('\n');
}
