<?php
// Runs the real, unmodified qtype_formulas code on a list of answers.
// usage: php harness.php <fake-moodle-root> <input.json> <output.json>
// input: [{t: text, a: "model answer", p: postunit}, ...]
// Only Moodle's own base classes and helpers are stubbed below; all grading is the plugin's.

define('MOODLE_INTERNAL', true);
define('FORMAT_HTML', 1);
define('FORMAT_MOODLE', 0);
define('FORMAT_PLAIN', 2);
define('FORMAT_MARKDOWN', 4);

global $CFG;
$CFG = new stdClass();
$CFG->dirroot = $argv[1];
$CFG->libdir = $argv[1] . '/lib';

function get_string($id, $component = '', $a = null) { return (string) $id; }
function get_config($plugin, $name = null) {
    if ($name === 'version') { return 2026100800; }
    return false; // allowdecimalcomma off: the plugin's default
}

// Moodle's question engine base types: empty shells so the plugin's files load.
foreach (['question_automatically_gradable_with_multiple_parts', 'question_automatically_gradable',
          'question_manually_gradable', 'moodle_exception_interface'] as $i) {
    if (!interface_exists($i)) { eval("interface $i {}"); }
}
spl_autoload_register(function ($class) {
    global $CFG;
    if (strpos($class, 'qtype_formulas\\local\\') === 0) {
        $f = $CFG->dirroot . '/question/type/formulas/classes/local/' . substr($class, strlen('qtype_formulas\\local\\')) . '.php';
        if (is_file($f)) { require_once($f); return; }
    }
    if (strpos($class, '\\') === false) { eval("class $class {}"); }
});

require_once($CFG->dirroot . '/question/type/formulas/classes/local/formulas_part.php');

use qtype_formulas\local\formulas_part;
use qtype_formulas\local\evaluator;
use qtype_formulas\answer_unit_conversion;

$items = json_decode(file_get_contents($argv[2]), true);
$out = [];
$errors = 0;
foreach ($items as $it) {
    $part = new formulas_part();
    $part->evaluator = new evaluator();
    $part->partindex = 0;
    $part->numbox = 1;
    $part->answertype = 10;  // numeric, as on the NU review page (data-answertype="10")
    $part->vars1 = '';
    $part->vars2 = '';
    $part->answer = (string) $it['a'];
    $part->correctness = '_relerr < 0.01';
    $part->unitpenalty = 0.1;
    $part->postunit = (string) $it['p'];
    $part->ruleid = 1;       // Common SI units
    $part->otherrule = '';
    $part->subqtext = '';    // no placeholders: combined field, as on the NU review page

    $key = $part->has_combined_unit_field() ? '0_' : '0_0';
    $response = [$key => $it['t']];
    $row = ['number' => null, 'unit' => null, 'unitOk' => null, 'answer' => null, 'fraction' => null, 'unitParseError' => false, 'error' => null];
    try {
        $norm = $part->normalize_response($response);
        $row['number'] = $norm['0_0'] ?? '';
        $row['unit'] = $norm['0_1'] ?? '';
        $res = $part->grade($response);
        $row['unitOk'] = (bool) $res['unit'];
        $row['answer'] = (float) $res['answer'];
        // question.php grade_response(): fraction * (1 - unitpenalty) when the unit is wrong
        $row['fraction'] = $row['answer'] * ($res['unit'] ? 1 : 1 - $part->unitpenalty);
        if ($row['unit'] !== '') {
            $row['unitParseError'] = (new answer_unit_conversion())->parse_unit($row['unit']) === null;
        }
    } catch (Throwable $t) {
        $errors++;
        $row['error'] = get_class($t) . ': ' . $t->getMessage() . ' @' . basename($t->getFile()) . ':' . $t->getLine();
    }
    $out[] = $row;
}
file_put_contents($argv[3], json_encode($out, JSON_INVALID_UTF8_SUBSTITUTE));
fwrite(STDOUT, count($out) . " graded, $errors errors\n");
