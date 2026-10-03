import { Box, Text } from "ink";
import { useState } from "react";
import type { Answer, Question } from "../core/tools.ts";
import { Dialog } from "./Dialog.tsx";
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
  const footer = "enter continue · esc cancel and interrupt";

  if (!question)
    return (
      <Dialog title="Review answers" footer={footer}>
        {questions.map((q, i) => (
          <Text key={i}>
            <Text dimColor>{q.question} →</Text> <Text color="cyan">{answers[i]}</Text>
          </Text>
        ))}
        <Box marginTop={1}>
          <Select
            key="review"
            options={[
              { label: "Submit answers", value: "submit" },
              { label: "Start over", value: "restart" },
              { label: "Cancel", value: "cancel" },
            ]}
            onSelect={(choice) => {
              if (choice === "submit") onSubmit(questions.map((q, i) => ({ question: q.question, answer: answers[i]! })));
              else if (choice === "restart") setAnswers([]);
              else onCancel();
            }}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    );

  return (
    <Dialog title={`Question ${answers.length + 1} of ${questions.length}`} footer={footer}>
      <Text>{question.question}</Text>
      <Box marginTop={1}>
        {question.options && !custom ? (
          <Select
            key={answers.length}
            options={[...question.options.map((label) => ({ label, value: label })), { label: "Other — type an answer", value: null }]}
            onSelect={(choice) => (choice === null ? setCustom(true) : answer(choice))}
            onCancel={onCancel}
          />
        ) : (
          <TextField value={value} onChange={setValue} onSubmit={answer} onCancel={onCancel} placeholder="Type your answer…" />
        )}
      </Box>
    </Dialog>
  );
}
