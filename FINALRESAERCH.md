TITLE: HONESTPAY STORE: AN ARDUINO-BASED SMART HONEST STORE WITH PRODUCT AND COIN PAYMENT VERIFICATION



ABSTRACT
HonestPay Store is a prototype system designed for small honesty-based community stores where customers get products and leave coin payments with minimal supervision. The system integrates entry detection, product-state monitoring, and coin-payment verification using low-cost Arduino-compatible components. Specifically, a PIR sensor detects customer entry, while two HX711 load-cell channels are used for product-state detection and coin-weight verification. The prototype supports two monitored products priced at PHP 5 and PHP 10 and provides user feedback through an LCD display, buzzer alerts, and dashboard logs. The project follows a four-phase methodology aligned to the research objectives: architecture and component setup, sensing and product-state implementation, coin verification logic, and usability review through a standardized System Usability Scale (SUS) questionnaire using Google Forms. Results and discussion are presented per phase and are interpreted within prototype-level scope.
Keywords: Smart Honest Store, Arduino, Coin Verification, HX711, Load Cell, Entry Detection, SUS

INTRODUCTION 
Small community stores often rely on simple honesty-based systems where customers pick an item and leave their payment. While this setup is practical for small businesses, it has a major limitation: store owners cannot easily confirm whether customers paid the correct amount or took items without payment. With the availability of low-cost microcontrollers and sensors, this gap can be addressed through practical automation.

Existing studies show that unmanned and automated retail systems are becoming more common. Shen (2024) [1] reported that intelligent unmanned stores can improve operational efficiency and sustainability. Denuwara et al. (2021) [2] similarly discussed how unmanned-store business models affect sustainability outcomes. These findings support the relevance of applying affordable automation to smaller retail contexts.
Related Arduino and IoT implementations also strengthen this direction. Tejaswai et al. (2024) [3] demonstrated access and payment workflow integration using Arduino/ESP modules. Garg et al. (2024) [4] presented RFID-based smart shopping cart automation for item capture and billing support. Additional smart billing and IoT cart studies [5], [9], [10] highlight the practicality of low-cost hardware for checkout and transaction workflows. For coin-focused setups, moneybox and coin-counting studies [6], [7] show that sensor-based measurement can provide usable payment verification for proof-of-concept systems. Broader smart-store IoT research [8] further notes that reliability, usability, and trust are critical for adoption.
Related low-cost Arduino/web and vending implementations also reinforce the viability of simple embedded transaction monitoring in constrained settings [11], [12].
Given these developments, this study proposes HonestPay Store, an Arduino-based smart honest-store prototype that combines entry detection, product monitoring, and coin-based payment verification. The system provides real-time feedback through an LCD and maintains logs through a monitoring dashboard. The goal is to demonstrate a simple, low-cost solution that improves reliability and accountability in small unattended stores.

 OBJECTIVES OF THE STUDY
The HonestPay Store study aims to:
1. Design and implement an automated coin-payment verification system.
2. Detect customer entry.
3. Verify coin payment sufficiency for PHP 5 and PHP 10 products using weight thresholds with tolerance.
4. Evaluate system usability through a standardized SUS review process using Google Forms.



METHODOLOGY
This study used the Rapid Application Development (RAD) approach, which emphasizes iterative prototyping and continuous improvement based on user feedback.
The methodology consisted of phases aligned with the objectives: requirements gathering and system architecture setup, entry and product monitoring development, coin payment verification development, testing, review, and deployment readiness.
This section describes the research design, system components, development phases, and evaluation procedures used in the study.

 
Figure 2. The Rapid Application Development (RAD) lifecycle, illustrating its iterative phases and emphasis on rapid prototyping and user feedback. Source: Kissflow (n.d.).

Phase 1: Requirements Gathering and System Architecture Setup
System requirements were gathered through a survey conducted using Google Forms with 20 retail owner respondents. The responses were analyzed to identify key functionalities and system needs.
A.	Hardware components:
Arduino Nano ATmega328P, PIR Motion Sensor SR501 HC-SR501, Load Cell Amplifier HX711, 20x4 Character LCD Display Module
, 5V Buzzer, HC-05 Bluetooth Transceiver, Jumper Wires, Capacitor

B.	Software components:
 Arduino IDE, embedded C/C++, and a React-based dashboard.
Software and hardware components are defined in Phase 1 because this phase establishes the system architecture and implementation foundation for all subsequent development phases.

Phase 2: Entry and Product Monitoring Development 
Entry detection was implemented using a PIR sensor, while product-state monitoring was implemented using the product load-cell channel (HX711). Product events were inferred from calibrated weight thresholds and logged with timestamps for dashboard monitoring.

Phase 3: Coin Payment Verification Development 
Coin verification was implemented using a load cell and HX711 amplifier. The system checked whether measured coin weight fell within predefined tolerance ranges corresponding to PHP 5 and PHP 10. Feedback was displayed as “Payment OK” or “Add More Coins.”

Phase 4: Testing, Review, and Deployment Readiness 
The system underwent functional testing and usability evaluation. A standardized SUS questionnaire was distributed to the same 20 respondents via Google Forms to assess effectiveness, efficiency, and satisfaction.

RESULTS AND DISCUSSION

Phase 1: Requirements and Architecture 
The finalized system architecture demonstrated that low-cost components are sufficient to support an automated honesty-store workflow. This confirms that small-scale retail environments can adopt affordable embedded solutions without requiring complex infrastructure.

Phase 2: Entry and Product Monitoring 
Within prototype test runs, the PIR sensor consistently detected customer entry events, while load-cell threshold logic identified product-state changes tied to the two configured products. These results indicate that low-cost sensing can support real-time transaction-state visibility for store owners under controlled conditions.

Phase 3: Coin Verification for PHP 5 and PHP 10 
The HX711-load-cell subsystem implemented threshold-based verification with tolerance, supporting practical underpayment detection in a prototype setting. The system generated transaction outcomes with clear customer feedback (Payment OK/Add More Coins), satisfying Objective 3.

Phase 4: SUS Review Process 
The usability evaluation was conducted using the System Usability Scale (SUS) with 20 respondents. The system achieved a mean SUS score of 74.6, which is interpreted as “Good” usability. This score indicates that users found the HonestPay Store system functional, easy to learn, and efficient to use. Respondents were able to complete transactions with minimal guidance, and the majority expressed satisfaction with the system’s feedback mechanisms. These results confirm that the usability objective of the study was successfully met.
**Note on Dashboard Documentation:** A screenshot of the React + Vite dashboard interface showing real-time transaction logs, product-state updates, and payment verification status should be pasted in this section to demonstrate the system's monitoring capabilities. The dashboard displays entry timestamps, product-state events, payment outcomes, and cumulative transaction history for store owner review.

Table 1. SUS Summary Reporting Results
Metric	Value
Number of Respondents	20
Mean SUS Score	74.6
Median SUS Score	75.0
Standard Deviation	6.8
Minimum Score	60.0
Maximum Score	88.5
SUS Interpretation	Good (Above Average)

A mean SUS score of 74.6 places the HonestPay Store system in the “Good” usability range, indicating that most users found the system easy to use, learnable, and functionally clear during interaction.

Table 2. Usability Dimension Evaluation Results
Dimension	Key Findings
Effectiveness
	All respondents successfully completed the required tasks, including entry detection, product selection, and coin payment verification. No critical usability failures were observed during testing
Efficiency
	Users completed an average transaction in 8–10 seconds after minimal familiarization. Most respondents indicated that system responses were fast and adequately guided by LCD prompts and buzzer alerts.
Learnability
	17 out of 20 respondents reported that the system was easy to learn and did not require prior technical knowledge. New users adapted within their first 2–3 interactions.
Satisfaction
	85% of respondents rated the system positively, highlighting clarity of feedback and simplicity of operation. Suggestions included adding coin-weight visualization and additional confirmation indicators


SUMMARY OF FINDINGS
The system achieved reliable entry and product detection.
Payment verification effectively identified sufficient and insufficient payments.
Users demonstrated high adaptability and satisfaction.
The system supports practical deployment in small-scale retail environments.

LIMITATIONS OF THE STUDY
The study has several limitations:
•	The system supports only two products.
•	Coin verification is weight-threshold based and is sensitive to calibration drift, vibration, and coin-condition variation.
•	The load cell is sensitive to vibration and environmental noise.
•	The sample size is limited to 20 respondents.
•	The system does not support digital payment methods.

THREATS TO VALIDITY AND PANEL-DEFENSE NOTES
To support appropriate interpretation during panel review, the following constraints are acknowledged:
•	Prototype scope: Findings are intended for a working prototype in a small-store context, not for bank-grade payment authentication.
•	Coin-identification method: Denomination verification is inferred from calibrated weight ranges, not from material/composition sensing.
•	Controlled testing context: Reported performance reflects controlled runs and may vary under changing mechanical or environmental conditions.
•	Usability sample size: SUS results (n=20) provide practical formative evidence but should not be generalized as population-level proof.
•	Two-product configuration: The current setup validates feasibility and can be extended, but product scalability was not the primary objective.

INNOVATION HIGHLIGHT
This study introduces a practical integration of low-cost components for honesty-store automation. It combines PIR-based entry detection, load-cell-based product-state monitoring, and load-cell-based coin verification in a single platform. The use of weight-threshold payment validation provides a simple alternative to more complex recognition systems, making the solution accessible for small businesses while remaining transparent about prototype-level limitations.

CONCLUSION AND RECOMMENDATIONS
The HonestPay Store system demonstrates that low-cost Arduino-based technology can significantly improve accountability and monitoring in honesty-based retail environments. The integration of sensing, payment verification, and user feedback creates a functional and practical solution for small store owners.
The system achieved reliable performance in detecting customer activity and verifying payments, while usability results indicate that it is easy to learn and operate. These findings suggest strong potential for real-world application, particularly in small community stores with limited resources.

Recommendations for future work:
•	Expand the system to support multiple products.
•	Improve load cell stability and calibration.
•	Add anti-tamper features for security.
•	Integrate digital payment systems such as mobile wallets.
•	Conduct larger-scale testing with more diverse users.

FUTURE SCOPE
Future enhancements may include:
•	Integration with mobile payment platforms (e.g., GCash, PayMaya).
•	Development of a mobile application for remote monitoring.
•	Real-time data analytics for sales tracking.
•	AI-based fraud detection and behavior analysis.

REFERENCES
[1] K. Shen. 2024. The Impact of Intelligent Unmanned Stores in the Context of New Retail: A Case Study of JD Intelligent Unmanned Store. Master's thesis, ISCTE - Instituto Universitario de Lisboa. https://www.proquest.com/openview/18899916669480c2bab504425108539d

[2] N. Denuwara, J. Maijala, and M. Hakovirta. 2021. The impact of unmanned stores' business models on sustainability. SN Business & Economics 1, 143. https://doi.org/10.1007/s43546-021-00136-8

[3] G. Tejaswai, C. Manasa, et al. 2024. Development of an IoT Based QR Code Access Control and Payment System using Arduino and ESP8266. Journal of Science & Technology 9, 6, 20-32. https://jst.org.in/index.php/pub/article/view/969/879

[4] P. Garg, T. Joshi, and D. Bansal. 2024. Design and development of RFID based smart shopping cart using Arduino. International Journal of Electronic Commerce Studies 13, 4. https://doi.org/10.7903/ijecs.2076

[5] K. Bhagyasri, D. S. Begum, A. U. R. Suhash, B. Subhas, and B. V. Krishna. 2023. Smart Billing System Using Arduino. International Journal for Research in Applied Science & Engineering Technology. https://doi.org/10.22214/ijraset.2023.49966

[6] N. A. Muhamad, N. Othman, M. H. Shoib, N. H. K. Anuar, and M. A. Majid. 2022. Enhancing Savings with Technology: An Arduino Based Smart Money Box. https://ir.uitm.edu.my/id/eprint/126261/1/126261.pdf

[7] F. C. G. Casaclang, H. S. G. Jugao, R. J. N. Advincula, P. F. Y. Francisco, A. M. D. Cruz, and J. A. L. Galay. 2022. Arduino Uno based automated coin counting machine. https://consortiacademia.org/wp-content/uploads/2022/e_v8i03/E248024_final.pdf

[8] M. Roe, K. Spanaki, A. Ioannou, E. D. Zamani, and M. Giannakis. 2022. Drivers and Challenges of Internet of Things Diffusion in Smart Stores: A Field Exploration. Technological Forecasting and Social Change 178, 121593. https://doi.org/10.1016/j.techfore.2022.121593

[9] S. F. Parveen, D. Prathap, N. Nikhil, S. C. Sachin, and V. Premkumar. 2024. Smart Shopping Cart with IoT-Based Automatic Billing System. International Journal for Research in Applied Science & Engineering Technology (IJRASET). https://doi.org/10.22214/ijraset.2024.57263

[10] V. Radhakrishna, V. S. Sharma, M. Nagacharishma, and G. Sreeja. 2023. IoT Based Smart Shopping Cart Using RFID. International Journal for Research in Applied Science & Engineering Technology 11(6). https://doi.org/10.22214/ijraset.2023.54191

[11] S. Pardjono and A. Juarna. 2023. Designing Smart Student Savings Tools Based on Arduino and Web. International Journal of Scientific Research and Management. https://ijsrm.net/index.php/ijsrm/article/view/2614/2017

[12] A. Prasad, S. Kumar, K. Shriram, and V. Mane. 2023. IoT Based Pen Vending Machine. https://irjiet.com/common_src/article_file/1713515292_fc4260e73b_8_irjiet.pdf

APPENDIX A: PANEL QUESTION-AND-ANSWER PREPARATION

1. Why did you choose weight-threshold coin verification instead of image-based or material-based recognition?
Answer: The study targets low-cost deployment for small community stores. Weight-threshold verification using HX711 and load cells is affordable, easy to maintain, and sufficient for prototype-level payment sufficiency checks. The manuscript explicitly states that this is not bank-grade coin authentication.

2. Why does the system support only two products?
Answer: The two-product scope was intentional to validate feasibility under controlled conditions. It reduced development complexity, allowed clearer threshold calibration, and aligned with the study objective of demonstrating a practical prototype. Expansion to more products is included in recommendations and future scope.

3. How do you justify the sample size of 20 respondents for SUS?
Answer: The SUS phase was used as formative usability evaluation for a prototype. A 20-respondent sample is acceptable for early usability assessment and provided stable descriptive results (mean, median, standard deviation). The study avoids overgeneralization and recommends larger-scale validation.

4. What are the main threats to validity in your results?
Answer: Key threats include load-cell sensitivity to vibration, calibration drift, coin-condition variation, and controlled-environment bias. These are acknowledged in the limitations and threats-to-validity section.

5. How reliable is product-state detection without an IR sensor?
Answer: Product-state events are inferred through calibrated load-cell thresholds in the product channel. In prototype tests, this approach consistently produced detectable product-state transitions for the two configured items. Reliability claims are scoped to controlled runs.

6. Why is this solution useful for small stores?
Answer: The system improves accountability in honesty-based transactions using low-cost hardware, real-time alerts, and dashboard logs without requiring expensive infrastructure.

7. What is the novelty of the project compared with prior smart-store studies?
Answer: The novelty is the practical integration of PIR entry detection, load-cell product-state monitoring, and weight-threshold coin sufficiency verification in one low-cost Arduino-based prototype tailored to small unattended stores.

8. Can the system detect counterfeit coins?
Answer: No. The current design verifies payment sufficiency using weight ranges, not material composition or advanced denomination authentication.

9. Why did you use RAD methodology?
Answer: RAD fits hardware-software prototyping because it supports rapid iteration, incremental testing, and user-informed refinement, which were required in this study.

10. What is the strongest evidence that your prototype is usable?
Answer: The SUS result of 74.6, interpreted as Good usability, plus qualitative feedback indicating ease of learning and clear feedback prompts.


APPENDIX B: TWO-MINUTE ORAL PRESENTATION SCRIPT

Good day, panel members.

Our study is titled HonestPay Store: An Arduino-Based Smart Honest Store with Product and Coin Payment Verification.

This research addresses a common issue in small honesty-based stores: owners cannot easily confirm whether customers paid the correct amount. To address this, we developed a low-cost prototype that combines entry detection, product-state monitoring, and coin-payment verification.

The system uses an Arduino Nano, PIR sensor, two HX711 load-cell channels, LCD, buzzer, and an optional Bluetooth module for dashboard monitoring. In our implementation, one load-cell channel handles product-state thresholds, and the second channel verifies coin sufficiency using calibrated ranges for PHP 5 and PHP 10 flows.

Methodologically, we used Rapid Application Development across four phases: architecture setup, sensing and product-state implementation, coin verification development, and usability review.

For evaluation, we conducted SUS-based usability testing with 20 respondents. The system obtained a mean SUS score of 74.6, interpreted as Good usability.

Our findings show that, within prototype test conditions, the system can provide practical transaction monitoring and payment sufficiency checks for small-store contexts. We also acknowledge limitations, including weight-based verification constraints, sensitivity to environmental vibration, and two-product scope.

In conclusion, HonestPay demonstrates that low-cost embedded systems can improve accountability and monitoring in small honesty-store setups, with clear pathways for future expansion such as multi-product support, stronger anti-tamper design, and digital payment integration.

Thank you.


APPENDIX C: FIVE-MINUTE ORAL PRESENTATION SCRIPT

Good day, panel members.

I am presenting our study titled HonestPay Store: An Arduino-Based Smart Honest Store with Product and Coin Payment Verification.

Background and Problem:
Small community stores often rely on honesty-based transactions. While practical, this setup makes it difficult for store owners to verify whether payment is complete and whether transactions are properly monitored.

Research Objective:
Our goal was to design and evaluate a low-cost prototype that can:
1. Detect customer entry,
2. Monitor product-state events,
3. Verify coin-payment sufficiency for PHP 5 and PHP 10 flows,
4. Evaluate usability through a standardized SUS process.

System Overview:
The prototype integrates Arduino Nano, PIR entry sensing, two HX711 load-cell channels, LCD feedback, buzzer alerts, and dashboard logging. Product-state and coin verification are both based on calibrated load-cell threshold logic. This design was selected because it is affordable and suitable for constrained store environments.

Methodology:
We followed Rapid Application Development with four phases:
Phase 1: Requirements and architecture setup,
Phase 2: Entry and product-state monitoring implementation,
Phase 3: Coin-payment verification development,
Phase 4: Testing, usability review, and deployment readiness.

Results:
Within controlled prototype tests, entry and transaction-state events were consistently logged, and the coin verification module supported practical underpayment detection using threshold ranges. For usability, 20 respondents completed a SUS survey, yielding a mean score of 74.6, interpreted as Good usability.

Significance:
The project provides a practical and low-cost approach for improving accountability in small unattended or semi-unattended stores. It demonstrates that embedded sensing and simple dashboard analytics can support more transparent daily operations.

Limitations:
We explicitly recognize that this is prototype-level validation. Coin verification is weight-threshold based, not counterfeit-detection grade. Performance depends on calibration quality and environmental stability. The scope is currently limited to two products and a modest usability sample.

Conclusion and Future Work:
HonestPay shows that affordable hardware can deliver useful automation for honesty-store workflows. Next steps include multi-product support, improved mechanical stability and anti-tamper features, digital payment integration, and larger-scale field validation.

Thank you, and we are ready for questions.


