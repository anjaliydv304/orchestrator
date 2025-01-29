import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: `
    You are an expert in breaking tasks into subtasks. Decompose tasks logically, identify dependencies, 
    and group parallelizable subtasks together.
  `,
})

const prompt = "Write an article on benefits of meditation"

async function main() {
    const result = await model.generateContent({
        contents:[
            {
                role:"user",
                parts:[{text:prompt}],
            },
        ],
        generationConfig:{
            maxOutputTokens:1000,
            temperature:0.7,
        },
    });
    console.log("Task decomposition:\n",result.response.text());

    const responseJson={
        prompt:prompt,
        response:result.response.text()
    };
    fs.writeFileSync("tasks.json",JSON.stringify(responseJson, null, 2), "utf-8");

}
main();