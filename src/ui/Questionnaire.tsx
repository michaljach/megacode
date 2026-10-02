import { Box, Text } from "ink";
import { useState } from "react";
import type { Answer, Question } from "../core/tools.ts";
import { Select } from "./Select.tsx";
import { TextField } from "./TextField.tsx";

/** Collect all answers before submitting anything to the model. */
export function Questionnaire({ questions, onSubmit, onCancel }: {
  questions: Question[];
  onSubmit: (answers: Answer[]) => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const [custom, setCustom] = useState(false);
  const question = questions[answers.length];
  function answer(text: string) {
    if (!text.trim()) return;
    setAnswers([...answers, text.trim()]);
    setValue("");
    setCustom(false);
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">{question ? `Question ${answers.length + 1} of ${questions.length}` : "Review answers"}</Text>
      {question ? <>
        <Text>{question.question}</Text>
        {question.options && !custom ? (
          <Select key={answers.length} options={[
            ...question.options.map((label) => ({ label, value: label })),
            { label: "Other — type an answer", value: null },
          ]} onSelect={(choice) => choice === null ? setCustom(true) : answer(choice)} onCancel={onCancel} />
        ) : (
          <TextField value={value} onChange={setValue} onSubmit={answer} onCancel={onCancel} placeholder="Type your answer…" />
        )}
      </> : <>
        {questions.map((q, i) => <Text key={i}>{q.question}: <Text color="cyan">{answers[i]}</Text></Text>)}
        <Select key="review" options={[
          { label: "Submit answers", value: "submit" },
          { label: "Start over", value: "restart" },
          { label: "Cancel", value: "cancel" },
        ]} onSelect={(choice) => {
          if (choice === "submit") onSubmit(questions.map((q, i) => ({ question: q.question, answer: answers[i]! })));
          else if (choice === "restart") setAnswers([]);
          else onCancel();
        }} onCancel={onCancel} />
      </>}
      <Text dimColor>Enter to continue · Esc to cancel and interrupt</Text>
    </Box>
  );
}
