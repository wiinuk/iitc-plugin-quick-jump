//@ts-check
const tsutils = require("tsutils");
const ts = require("typescript");

const nullOrUndefinedLikeTypeFlag =
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Any;

/**
 * @param {ts.TypeChecker} checker
 * @param {ts.Node} node
 */
const isNullableType = (checker, node) => {
    const nodeType = checker.getTypeAtLocation(node);
    for (const t of tsutils.unionTypeParts(checker.getApparentType(nodeType))) {
        if (t.flags & nullOrUndefinedLikeTypeFlag) return true;
    }
    return false;
};

/**
 * @param {ts.SourceFile} sourceFile
 * @param {number} position
 */
const getPosition = (sourceFile, position) => {
    const { line, character } =
        sourceFile.getLineAndCharacterOfPosition(position);
    return {
        line: line + 1,
        column: character,
    };
};
/**
 * @param {ts.SourceFile} sourceFile
 * @param {number} start
 * @param {number} end
 */
const getLocation = (sourceFile, start, end) => {
    return {
        start: getPosition(sourceFile, start),
        end: getPosition(sourceFile, end),
    };
};

/**
 * @typedef {"replace_unneeded_QuestionDot_with_Dot" | "remove_unneeded_QuestionDot"} MessageIds
 */

/** @type {import("@typescript-eslint/experimental-utils").TSESLint.RuleModule<MessageIds>} */
const rule = {
    meta: {
        docs: {
            description: "Detect unneeded 'await'.",
            recommended: "warn",
            suggestion: true,
            requiresTypeChecking: true,
        },
        fixable: "code",
        hasSuggestions: true,
        messages: {
            replace_unneeded_QuestionDot_with_Dot:
                "Replace unneeded '?.' with '.'.",
            remove_unneeded_QuestionDot: "Remove unneeded '?.'.",
        },
        schema: null,
        type: "suggestion",
    },
    create(context) {
        const parserServices = context.parserServices;
        const checker = parserServices.program.getTypeChecker();

        return {
            MemberExpression(node) {
                if (!node.optional) return;
                // `o.p` や `o[k]` のような場合

                const member = parserServices.esTreeNodeToTSNodeMap.get(node);

                if (!isNullableType(checker, member.expression)) {
                    const { questionDotToken } = member;
                    const start = questionDotToken.getStart();
                    const end = questionDotToken.getEnd();
                    const loc = getLocation(member.getSourceFile(), start, end);
                    const range = /** @type {const} */ ([start, end]);

                    if (ts.isPropertyAccessExpression(member)) {
                        // `o.?p` のような場合 `o.p` に置き換え
                        context.report({
                            loc,
                            messageId: "replace_unneeded_QuestionDot_with_Dot",
                            fix(fixer) {
                                return fixer.replaceTextRange(range, ".");
                            },
                        });
                    } else {
                        // `o.?[k]` のような場合 `o[k]` に置き換え
                        context.report({
                            loc,
                            messageId: "remove_unneeded_QuestionDot",
                            fix(fixer) {
                                return fixer.removeRange(range);
                            },
                        });
                    }
                }
            },
        };
    },
};
module.exports = rule;
